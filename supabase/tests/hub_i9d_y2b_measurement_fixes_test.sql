-- pgTAP: poprawki R1 zgody na pomiar otwarć i kliknięć (I9d-Y2b; migracja
-- 20261023090300; przegląd R1 PR 533: sql-r1-1, zgoda-r1-1, sql-r1-2,
-- sql-r1-3, zgoda-r1-3, regresje-r1-1, zgoda-r1-2, sql-r1-4).
--
-- CO PRZYPINA:
--   * kolumny personelu: `authenticated` nie czyta `confirmation_token`
--     i nie zmienia tokenu, deklaracji (`consents`) ani adresu (redaktor
--     z JWT - 42501); panel (wypis, „Przywróć") działa;
--   * strona DOI wymaga sekretu skrzynki: sygnatur z samym tokenem nie ma,
--     cudzy subskrybent albo adres zmieniony po wysyłce - invalid, inna
--     wersja i termin poza oknem - none, treść sekretu z maila - granted;
--     stary link DOI po odświeżeniu deklaracji przez osobę trzecią - none
--     (scenariusz probe3); „nie" po wysłaniu maila - declined/already;
--   * prośby: zajęcie zapisuje adres wysyłki, potwierdzenie po zmianie
--     adresu - invalid i brak pomiaru dla nowego adresu;
--   * odmowa bez zgody (preferencje, stopka, konto): jeden wpis „nie"
--     z kanałem odmowy, `refused`, wykluczenie z próśb; także po neutralnym
--     „nie" wypisu i „Przywróć";
--   * wycofanie newsletter/marketing zamyka łańcuch pomiaru, retencja
--     łańcucha marketing nie wskrzesza pomiaru (P5), historyczny wpis nie
--     zamyka późniejszego „tak";
--   * domknięcie jednorazowe: wypisany przed wyzwalaczem z dawną zaufaną
--     parą (a), `pending` po wypisie, aktywny z wycofaniem marketing -
--     „nie" neutralne; „Przywróć" nie wskrzesza; powtórka = 0; treść = treść
--     wyzwalacza wypisu;
--   * ACL nowych funkcji i wyzwalacz.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9d_y2b_measurement_fixes
BEGIN;
SELECT plan(23);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('19dc0000-0000-4000-8000-0000000000a0', 'i9d-y2b-r1-a', 'I9d Y2b R1 A'),
  ('19dc0000-0000-4000-8000-0000000000b0', 'i9d-y2b-r1-b', 'I9d Y2b R1 B'),
  ('19dc0000-0000-4000-8000-0000000000c0', 'i9d-y2b-r1-c', 'I9d Y2b R1 C');
INSERT INTO auth.users (id, email) VALUES ('19dc0000-0000-4000-8000-00000000e001', 'redaktor@i9d-y2b-r1.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19dc0000-0000-4000-8000-00000000e001', 'redaktor@i9d-y2b-r1.test', 'Redaktor', '19dc0000-0000-4000-8000-0000000000a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19dc0000-0000-4000-8000-00000000e001', 'editor', '19dc0000-0000-4000-8000-0000000000a0');

CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON r TO authenticated, service_role;
CREATE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;
CREATE FUNCTION pg_temp.sub(p_key text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT s.id FROM public.newsletter_subscribers s WHERE s.email = p_key || '@i9d-y2b-r1.test'
$$;
CREATE FUNCTION pg_temp.consent(p_key text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT public._email_measurement_consent(s.tenant_id, s.email)
                     FROM public.newsletter_subscribers s WHERE s.email = p_key || '@i9d-y2b-r1.test'), false)
$$;
CREATE FUNCTION pg_temp.tick(p_lang text, p_at timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('key', 'email_measurement_declared', 'text', public._email_measurement_consent_default(p_lang),
                            'version', public._email_measurement_consent_version(), 'given', true, 'lang', p_lang,
                            'received_at', to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;
-- „Tak" z jawną chwilą (fikstura): flaga jak w `_email_measurement_grant`.
CREATE FUNCTION pg_temp.grant_at(p_sid uuid, p_at timestamptz, p_form text DEFAULT 'measurement:reconfirm',
                                 p_version text DEFAULT 'email-measurement-2026-10-23')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('nes.email_measurement_grant', 'on', true);
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, form_name, consent_key,
                                      consent_text, consent_version, given, lang, created_at)
  SELECT s.tenant_id, s.email, 'newsletter', s.id, p_form, 'email_measurement', 'email_measurement',
         public._email_measurement_consent_default('pl'), p_version, true, 'pl', p_at
    FROM public.newsletter_subscribers s WHERE s.id = p_sid;
  PERFORM set_config('nes.email_measurement_grant', '', true);
END $$;
CREATE FUNCTION pg_temp.optout_at(p_key text, p_at timestamptz, p_consent_key text DEFAULT 'marketing')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given, created_at)
  SELECT s.tenant_id, s.email, 'other', p_consent_key, 'Wycofanie', false, p_at
    FROM public.newsletter_subscribers s WHERE s.email = p_key || '@i9d-y2b-r1.test'
$$;
CREATE FUNCTION pg_temp.n_log(p_key text, p_consent_key text, p_given boolean DEFAULT NULL, p_form text DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM public.crm_consent_log
   WHERE lower(email) = p_key || '@i9d-y2b-r1.test' AND consent_key = p_consent_key
     AND (p_given IS NULL OR given = p_given) AND (p_form IS NULL OR form_id = p_form)
$$;
CREATE FUNCTION pg_temp.candidate(p_tenant uuid, p_key text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public._newsletter_measurement_candidates(p_tenant) x
                  WHERE x.subscriber_id = pg_temp.sub(p_key))
$$;
-- Decyzja na stronie DOI z treścią podpisanego parametru `m` (podpis HMAC
-- sprawdza serwer TS): domyślnie subskrybent i adres z wiersza tokenu,
-- bieżąca wersja, termin za 30 dni.
CREATE FUNCTION pg_temp.doi(p_key text, p_grant boolean, p_ip text DEFAULT NULL, p_ua text DEFAULT NULL,
                            p_expires timestamptz DEFAULT now() + interval '30 days', p_sid uuid DEFAULT NULL,
                            p_email text DEFAULT NULL, p_version text DEFAULT 'email-measurement-2026-10-23')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.newsletter_doi_measurement_decide(md5(p_key), COALESCE(p_sid, s.id), COALESCE(p_email, s.email),
                                                  p_version, p_expires, p_grant, p_ip, p_ua)
    FROM public.newsletter_subscribers s WHERE s.confirmation_token = md5(p_key)
$$;

-- ── 1. Kolumny personelu ─────────────────────────────────────────────────────
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.newsletter_subscribers', 'confirmation_token', 'SELECT')
  AND has_column_privilege('authenticated', 'public.newsletter_subscribers', 'consents', 'SELECT')
  AND has_column_privilege('authenticated', 'public.newsletter_subscribers', 'email', 'SELECT')
  AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['confirmation_token', 'confirmation_expires_at', 'confirmed_at', 'consents',
                                             'email', 'tenant_id', 'ip', 'user_agent', 'unsubscribe_token', 'user_id',
                                             'source_form_id', 'last_engaged_at']) c
                   WHERE has_column_privilege('authenticated', 'public.newsletter_subscribers', c, 'UPDATE'))
  AND has_column_privilege('authenticated', 'public.newsletter_subscribers', 'status', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.newsletter_subscribers', 'unsubscribed_at', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.newsletter_subscribers', 'SELECT'),
  'kolumny personelu: bez odczytu tokenu DOI; zapis tylko statusu, wypisu i danych panelu');

INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, confirmation_token)
VALUES ('19dc0000-0000-4000-8000-0000000000a0', 'v1@i9d-y2b-r1.test', 'subscribed', 'pl', md5('v1'));
SELECT pg_temp.as_user('19dc0000-0000-4000-8000-00000000e001');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT confirmation_token FROM public.newsletter_subscribers WHERE email = 'v1@i9d-y2b-r1.test' $$,
  '42501', NULL, 'redaktor (RLS): odczyt tokenu DOI - 42501');
SELECT throws_ok($$ UPDATE public.newsletter_subscribers SET confirmation_token = repeat('ab', 16)
                     WHERE email = 'v1@i9d-y2b-r1.test' $$,
  '42501', NULL, 'redaktor: zapis własnego tokenu DOI - 42501');
SELECT throws_ok($$ UPDATE public.newsletter_subscribers
                       SET consents = '[{"key": "email_measurement_declared", "given": true}]'::jsonb
                     WHERE email = 'v1@i9d-y2b-r1.test' $$,
  '42501', NULL, 'redaktor: wpisanie deklaracji pola pomiaru - 42501');
SELECT throws_ok($$ UPDATE public.newsletter_subscribers SET email = 'atak@i9d-y2b-r1.test'
                     WHERE email = 'v1@i9d-y2b-r1.test' $$,
  '42501', NULL, 'redaktor: zmiana adresu subskrybenta - 42501');
UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now() WHERE email = 'v1@i9d-y2b-r1.test';
INSERT INTO r SELECT 'panel', to_jsonb(count(*)) FROM public.newsletter_subscribers
 WHERE email = 'v1@i9d-y2b-r1.test' AND status = 'unsubscribed';
UPDATE public.newsletter_subscribers SET status = 'subscribed', unsubscribed_at = NULL WHERE email = 'v1@i9d-y2b-r1.test';
RESET ROLE;
SELECT ok(
  (SELECT v = '1'::jsonb FROM r WHERE k = 'panel')
  AND (SELECT status = 'subscribed' AND unsubscribed_at IS NULL AND confirmation_token = md5('v1')
         FROM public.newsletter_subscribers WHERE email = 'v1@i9d-y2b-r1.test'),
  'panel redaktora: odczyt jawnych kolumn, wypis i „Przywróć" działają; token bez zmian');

-- ── 2. Strona DOI: sekret skrzynki ───────────────────────────────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, consents, confirmation_token, confirmed_at)
SELECT '19dc0000-0000-4000-8000-0000000000a0', k || '@i9d-y2b-r1.test', 'subscribed', 'pl',
       jsonb_build_array(pg_temp.tick('pl', now() - d)), md5(k), now() - d
  FROM (VALUES ('d1', interval '1 hour'), ('d2', interval '1 hour'), ('d3', interval '400 days'),
               ('d4', interval '10 days')) x(k, d);
SELECT ok(
  to_regprocedure('public.newsletter_doi_measurement_state(text)') IS NULL
  AND to_regprocedure('public.newsletter_doi_measurement_decide(text, boolean, text, text)') IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon', 'authenticated']) r
     CROSS JOIN unnest(ARRAY['public.newsletter_doi_measurement_state(text, uuid, text, text, timestamptz)',
                             'public.newsletter_doi_measurement_decide(text, uuid, text, text, timestamptz, boolean, text, text)']) f
     WHERE has_function_privilege(r, f, 'EXECUTE')),
  'strona DOI: sygnatur z samym tokenem DOI nie ma; nowe - wyłącznie service_role');
INSERT INTO r SELECT 'x_sid', pg_temp.doi('d1', true, p_sid => pg_temp.sub('d2'));
INSERT INTO r SELECT 'x_mail', pg_temp.doi('d1', true, p_email => 'inny@i9d-y2b-r1.test');
INSERT INTO r SELECT 'x_ver', pg_temp.doi('d1', true, p_version => 'newsletter-2026-10-21');
INSERT INTO r SELECT 'x_exp', pg_temp.doi('d1', true, p_expires => now() - interval '1 minute');
INSERT INTO r SELECT 'x_far', pg_temp.doi('d1', true, p_expires => now() + interval '90 days');
INSERT INTO r SELECT 'x_null', pg_temp.doi('d1', true, p_expires => NULL);
SELECT ok(
  (SELECT v = '{"result": "invalid"}'::jsonb FROM r WHERE k = 'x_sid')
  AND (SELECT v = '{"result": "invalid"}'::jsonb FROM r WHERE k = 'x_mail')
  AND (SELECT bool_and(v = '{"result": "none", "lang": "pl"}'::jsonb) FROM r WHERE k IN ('x_ver', 'x_exp', 'x_far', 'x_null'))
  AND pg_temp.n_log('d1', 'email_measurement') = 0 AND NOT pg_temp.consent('d1'),
  'token DOI bez pasującego sekretu: cudzy subskrybent albo adres - invalid; inna wersja, termin minął, poza oknem albo brak - none; zero wpisów');
INSERT INTO r SELECT 'ok', pg_temp.doi('d1', true, '198.51.100.20', 'UA R1');
SELECT ok(
  (SELECT v = '{"result": "granted", "lang": "pl"}'::jsonb FROM r WHERE k = 'ok')
  AND pg_temp.consent('d1') AND pg_temp.n_log('d1', 'email_measurement', true, 'measurement:doi') = 1
  AND (SELECT ip = '198.51.100.20' AND user_agent = 'UA R1' FROM public.crm_consent_log
        WHERE email = 'd1@i9d-y2b-r1.test' AND consent_key = 'email_measurement'),
  'treść sekretu z maila (subskrybent, adres, wersja, termin) - granted, wpis measurement:doi z IP i UA');
-- Wariant 2 z przeglądu: adres wiersza zmieniony po wysłaniu maila DOI
-- (personel nie ma już UPDATE kolumny email - tu serwer).
INSERT INTO r SELECT 'd2_id', to_jsonb(pg_temp.sub('d2'));
UPDATE public.newsletter_subscribers SET email = 'd2b@i9d-y2b-r1.test' WHERE email = 'd2@i9d-y2b-r1.test';
INSERT INTO r SELECT 'd2', public.newsletter_doi_measurement_decide(
  md5('d2'), (SELECT (v #>> '{}')::uuid FROM r WHERE k = 'd2_id'), 'd2@i9d-y2b-r1.test',
  'email-measurement-2026-10-23', now() + interval '30 days', true);
SELECT ok(
  (SELECT v = '{"result": "invalid"}'::jsonb FROM r WHERE k = 'd2')
  AND NOT pg_temp.consent('d2b') AND pg_temp.n_log('d2b', 'email_measurement') = 0,
  'adres zmieniony po wysłaniu maila DOI: sekret starego adresu - invalid, nowy adres bez pomiaru');
-- probe3: DOI 400 dni temu, odmowa 399 dni temu, deklaracja odświeżona dziś
-- przez osobę trzecią (publiczny formularz).
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, form_name, consent_key,
                                    consent_text, consent_version, given, lang, created_at)
VALUES ('19dc0000-0000-4000-8000-0000000000a0', 'd3@i9d-y2b-r1.test', 'newsletter', pg_temp.sub('d3'),
        'measurement:doi_declined', 'email_measurement', 'email_measurement', 'Odmowa', 'email-measurement-2026-10-23',
        false, 'pl', now() - interval '399 days'),
       ('19dc0000-0000-4000-8000-0000000000a0', 'd4@i9d-y2b-r1.test', 'newsletter', pg_temp.sub('d4'),
        'measurement:doi_declined', 'email_measurement', 'email_measurement', 'Odmowa', 'email-measurement-2026-10-23',
        false, 'pl', now() - interval '9 days');
UPDATE public.newsletter_subscribers SET consents = jsonb_build_array(pg_temp.tick('pl'))
 WHERE email IN ('d3@i9d-y2b-r1.test', 'd4@i9d-y2b-r1.test');
INSERT INTO r SELECT 'd3', pg_temp.doi('d3', true, p_expires => now() - interval '340 days');
SELECT ok(
  public._newsletter_measurement_offer_state(pg_temp.sub('d3')) = 'offer'
  AND (SELECT v ->> 'result' = 'none' FROM r WHERE k = 'd3')
  AND NOT pg_temp.consent('d3') AND pg_temp.n_log('d3', 'email_measurement', true) = 0,
  'stary link DOI (400 dni) po odświeżeniu deklaracji przez osobę trzecią - none (deklaracja otwiera tylko prośbę mailem)');
INSERT INTO r SELECT 'd4', pg_temp.doi('d4', true, p_expires => now() + interval '50 days');
SELECT ok(
  public.newsletter_doi_measurement_state(md5('d4'), pg_temp.sub('d4'), 'd4@i9d-y2b-r1.test',
                                          'email-measurement-2026-10-23', now() + interval '50 days') ->> 'result' = 'declined'
  AND (SELECT v ->> 'result' = 'already' FROM r WHERE k = 'd4') AND NOT pg_temp.consent('d4'),
  'odmowa po wysłaniu maila DOI zamyka ofertę tego maila mimo nowszej deklaracji (declined, already)');

-- ── 3. Prośby związane z adresem wysyłki ─────────────────────────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language)
SELECT '19dc0000-0000-4000-8000-0000000000b0', k || '@i9d-y2b-r1.test', 'subscribed', 'pl'
  FROM (VALUES ('q1'), ('q2')) x(k);
INSERT INTO public.newsletter_measurement_requests (subscriber_id, consent_version, tenant_id, origin)
SELECT pg_temp.sub(k), 'email-measurement-2026-10-23', '19dc0000-0000-4000-8000-0000000000b0', 'panel'
  FROM (VALUES ('q1'), ('q2')) x(k);
CREATE TEMP TABLE claimed ON COMMIT DROP AS
  SELECT * FROM public.newsletter_measurement_claim(50, 'panel') c
   WHERE c.tenant_id = '19dc0000-0000-4000-8000-0000000000b0';
SELECT ok(
  (SELECT array_agg(c.email ORDER BY c.email) = ARRAY['q1@i9d-y2b-r1.test', 'q2@i9d-y2b-r1.test'] FROM claimed c)
  AND (SELECT bool_and(q.email_norm = s.email) FROM public.newsletter_measurement_requests q
         JOIN public.newsletter_subscribers s ON s.id = q.subscriber_id
        WHERE q.tenant_id = '19dc0000-0000-4000-8000-0000000000b0'),
  'zajęcie porcji zapisuje adres wysyłki (email_norm = adres w wierszu wyniku)');
INSERT INTO r SELECT 'q1_id', to_jsonb(pg_temp.sub('q1'));
UPDATE public.newsletter_subscribers SET email = 'q1b@i9d-y2b-r1.test' WHERE email = 'q1@i9d-y2b-r1.test';
INSERT INTO r SELECT 'q1', public.newsletter_measurement_confirm(
  (SELECT (v #>> '{}')::uuid FROM r WHERE k = 'q1_id'), (SELECT nonce FROM claimed WHERE email = 'q1@i9d-y2b-r1.test'));
INSERT INTO r SELECT 'q2', public.newsletter_measurement_confirm(
  pg_temp.sub('q2'), (SELECT nonce FROM claimed WHERE email = 'q2@i9d-y2b-r1.test'));
SELECT ok(
  (SELECT v ->> 'result' = 'invalid' FROM r WHERE k = 'q1')
  AND NOT pg_temp.consent('q1b') AND pg_temp.n_log('q1b', 'email_measurement') = 0
  AND (SELECT confirmed_at IS NULL FROM public.newsletter_measurement_requests
        WHERE subscriber_id = (SELECT (v #>> '{}')::uuid FROM r WHERE k = 'q1_id'))
  AND (SELECT v ->> 'result' = 'confirmed' FROM r WHERE k = 'q2') AND pg_temp.consent('q2'),
  'prośba: adres zmieniony po wysłaniu - invalid, brak pomiaru dla nowego adresu; adres wysyłki - confirmed');

-- ── 4. Odmowa bez zgody ──────────────────────────────────────────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language)
SELECT '19dc0000-0000-4000-8000-0000000000a0', k || '@i9d-y2b-r1.test', 'subscribed', l
  FROM (VALUES ('n1', 'pl'), ('n2', 'en'), ('n3', 'pl')) x(k, l);
INSERT INTO r SELECT 'n1_s0', public.email_measurement_state(pg_temp.sub('n1'), NULL);
INSERT INTO r SELECT 'n1_c0', to_jsonb(pg_temp.candidate('19dc0000-0000-4000-8000-0000000000a0', 'n1'));
INSERT INTO r SELECT 'n1_w1', public.email_measurement_withdraw(pg_temp.sub('n1'), NULL, 'preferences', '198.51.100.30', 'UA');
INSERT INTO r SELECT 'n1_w2', public.email_measurement_withdraw(pg_temp.sub('n1'), NULL, 'email_footer');
INSERT INTO r SELECT 'n1_s1', public.email_measurement_state(pg_temp.sub('n1'), NULL);
SELECT ok(
  (SELECT v ->> 'consent' = 'false' AND v ->> 'refused' = 'false' FROM r WHERE k = 'n1_s0')
  AND (SELECT v = 'true'::jsonb FROM r WHERE k = 'n1_c0')
  AND (SELECT v ->> 'result' = 'withdrawn' FROM r WHERE k = 'n1_w1')
  AND (SELECT v ->> 'result' = 'already' FROM r WHERE k = 'n1_w2')
  AND pg_temp.n_log('n1', 'email_measurement', false) = 1
  AND (SELECT form_id = 'measurement:preferences' AND consent_text LIKE 'Odmowa zgody na pomiar%' AND ip = '198.51.100.30'
              AND consent_version = 'email-measurement-2026-10-23'
         FROM public.crm_consent_log WHERE email = 'n1@i9d-y2b-r1.test' AND consent_key = 'email_measurement')
  AND (SELECT v ->> 'refused' = 'true' AND v ->> 'consent' = 'false' FROM r WHERE k = 'n1_s1')
  AND NOT pg_temp.candidate('19dc0000-0000-4000-8000-0000000000a0', 'n1'),
  'odmowa osoby bez zgody: jeden wpis „nie" z kanałem i treścią odmowy, refused w stanie, wykluczenie z próśb, powtórka already');
SELECT pg_temp.grant_at(pg_temp.sub('n2'), now() - interval '2 days');
UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now() WHERE email = 'n2@i9d-y2b-r1.test';
UPDATE public.newsletter_subscribers SET status = 'subscribed', unsubscribed_at = NULL WHERE email = 'n2@i9d-y2b-r1.test';
INSERT INTO r SELECT 'n2_c0', to_jsonb(pg_temp.candidate('19dc0000-0000-4000-8000-0000000000a0', 'n2'));
INSERT INTO r SELECT 'n2_w', public.email_measurement_withdraw(pg_temp.sub('n2'), NULL, 'email_footer');
SELECT ok(
  (SELECT v = 'true'::jsonb FROM r WHERE k = 'n2_c0')
  AND (SELECT v ->> 'result' = 'withdrawn' AND v ->> 'lang' = 'en' FROM r WHERE k = 'n2_w')
  AND pg_temp.n_log('n2', 'email_measurement', false, 'measurement:email_footer') = 1
  AND (SELECT consent_text LIKE 'Refusal of consent%' FROM public.crm_consent_log
        WHERE email = 'n2@i9d-y2b-r1.test' AND form_id = 'measurement:email_footer')
  AND NOT pg_temp.candidate('19dc0000-0000-4000-8000-0000000000a0', 'n2'),
  'po neutralnym „nie" wypisu i „Przywróć": odmowa ze stopki zapisana (treść odmowy EN) i wyklucza z próśb');
SELECT pg_temp.grant_at(pg_temp.sub('n3'), now() - interval '1 day');
INSERT INTO r SELECT 'n3_w', public.email_measurement_withdraw(pg_temp.sub('n3'), NULL, 'account');
SELECT ok(
  (SELECT v ->> 'result' = 'withdrawn' FROM r WHERE k = 'n3_w') AND NOT pg_temp.consent('n3')
  AND (SELECT consent_text LIKE 'Wycofanie zgody na pomiar%' FROM public.crm_consent_log
        WHERE email = 'n3@i9d-y2b-r1.test' AND form_id = 'measurement:account' AND NOT given),
  'osoba ze zgodą (panel konta): treść wycofania, kanał account');

-- ── 5. Wycofanie newsletter/marketing zamyka łańcuch pomiaru ────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language)
SELECT '19dc0000-0000-4000-8000-0000000000c0', k || '@i9d-y2b-r1.test', 'subscribed', 'pl'
  FROM (VALUES ('o1'), ('o2')) x(k);
-- P5: „tak" 7 lat temu, wycofanie marketingu dzień później (bez wypisu).
SELECT pg_temp.grant_at(pg_temp.sub('o1'), now() - interval '7 years');
SELECT pg_temp.optout_at('o1', now() - interval '7 years' + interval '1 day');
INSERT INTO r SELECT 'o1_ret', public._data_retention_consent_log('19dc0000-0000-4000-8000-0000000000c0', true, 1000);
SELECT ok(
  pg_temp.n_log('o1', 'email_measurement', false, 'measurement:opt_out') = 1
  AND (SELECT consent_text = public._email_measurement_expiry_text('opt_out', 'pl') AND created_at >= now()
         FROM public.crm_consent_log WHERE email = 'o1@i9d-y2b-r1.test' AND form_id = 'measurement:opt_out')
  AND pg_temp.n_log('o1', 'marketing') = 0 AND NOT pg_temp.consent('o1'),
  'wycofanie marketingu zamyka łańcuch pomiaru (measurement:opt_out); retencja łańcucha marketing nie wskrzesza pomiaru (P5)');
-- Historyczny wpis wycofania sprzed późniejszego „tak" (import) - bez zmian.
SELECT pg_temp.grant_at(pg_temp.sub('o2'), now() - interval '1 hour');
SELECT pg_temp.optout_at('o2', now() - interval '1 day', 'newsletter');
SELECT ok(
  pg_temp.consent('o2') AND pg_temp.n_log('o2', 'email_measurement', false) = 0,
  'wpis wycofania sprzed późniejszego „tak" nie zamyka nowej zgody');

-- ── 6. Domknięcie jednorazowe (stan sprzed wyzwalaczy Y2b) ───────────────────
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language)
SELECT '19dc0000-0000-4000-8000-0000000000a0', k || '@i9d-y2b-r1.test', 'subscribed', 'pl'
  FROM (VALUES ('f1'), ('f2'), ('f3'), ('f4'), ('f5')) x(k);
-- f1: dawna zaufana para (a) z potwierdzoną prośbą (a).
SELECT pg_temp.grant_at(pg_temp.sub('f1'), now() - interval '1 day', 'newsletter:measurement_reconfirm',
                        'newsletter-2026-10-21');
INSERT INTO public.newsletter_measurement_requests (subscriber_id, consent_version, tenant_id, mailed_at, mail_outcome,
                                                    confirmed_at)
VALUES (pg_temp.sub('f1'), 'newsletter-2026-10-21', '19dc0000-0000-4000-8000-0000000000a0', now() - interval '2 days',
        'queued', now() - interval '1 day');
SELECT pg_temp.grant_at(pg_temp.sub(k), now() - interval '3 days') FROM (VALUES ('f2'), ('f3'), ('f4'), ('f5')) x(k);
INSERT INTO r SELECT 'f1_before', to_jsonb(pg_temp.consent('f1'));
ALTER TABLE public.newsletter_subscribers DISABLE TRIGGER trg_newsletter_unsubscribed_measurement;
ALTER TABLE public.crm_consent_log DISABLE TRIGGER trg_crm_consent_log_measurement_opt_out;
UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now() - interval '12 hours'
 WHERE email = 'f1@i9d-y2b-r1.test';
UPDATE public.newsletter_subscribers SET status = 'pending', unsubscribed_at = now() - interval '2 days'
 WHERE email = 'f2@i9d-y2b-r1.test';
SELECT pg_temp.optout_at('f3', now() - interval '1 day');
ALTER TABLE public.crm_consent_log ENABLE TRIGGER trg_crm_consent_log_measurement_opt_out;
ALTER TABLE public.newsletter_subscribers ENABLE TRIGGER trg_newsletter_unsubscribed_measurement;
UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now() WHERE email = 'f5@i9d-y2b-r1.test';
INSERT INTO r SELECT 'f_pre', to_jsonb(pg_temp.n_log('f1', 'email_measurement', false) + pg_temp.n_log('f2', 'email_measurement', false)
                                       + pg_temp.n_log('f3', 'email_measurement', false));
INSERT INTO r SELECT 'bf1', to_jsonb(public._email_measurement_close_backfill());
INSERT INTO r SELECT 'bf2', to_jsonb(public._email_measurement_close_backfill());
-- „Przywróć" w panelu po domknięciu.
UPDATE public.newsletter_subscribers SET status = 'subscribed', unsubscribed_at = NULL
 WHERE email IN ('f1@i9d-y2b-r1.test', 'f2@i9d-y2b-r1.test');
SELECT ok(
  (SELECT v = 'true'::jsonb FROM r WHERE k = 'f1_before') AND (SELECT v = '0'::jsonb FROM r WHERE k = 'f_pre')
  AND (SELECT (v #>> '{}')::int >= 3 FROM r WHERE k = 'bf1') AND (SELECT v = '0'::jsonb FROM r WHERE k = 'bf2')
  AND pg_temp.n_log('f1', 'email_measurement', false, 'measurement:unsubscribe') = 1
  AND pg_temp.n_log('f2', 'email_measurement', false, 'measurement:unsubscribe') = 1
  AND pg_temp.n_log('f3', 'email_measurement', false, 'measurement:opt_out') = 1
  AND pg_temp.n_log('f4', 'email_measurement', false) = 0 AND pg_temp.consent('f4'),
  'domknięcie: wypisany przed wyzwalaczem, pending po wypisie i aktywny z wycofaniem marketingu - „nie" neutralne; reszta bez zmian; powtórka = 0');
SELECT ok(
  NOT pg_temp.consent('f1') AND NOT pg_temp.consent('f2') AND NOT pg_temp.consent('f3')
  AND (SELECT consent_text FROM public.crm_consent_log WHERE email = 'f1@i9d-y2b-r1.test' AND form_id = 'measurement:unsubscribe')
      = (SELECT consent_text FROM public.crm_consent_log WHERE email = 'f5@i9d-y2b-r1.test' AND form_id = 'measurement:unsubscribe')
  AND (SELECT consent_text FROM public.crm_consent_log WHERE email = 'f5@i9d-y2b-r1.test' AND form_id = 'measurement:unsubscribe')
      = public._email_measurement_expiry_text('unsubscribe', 'pl'),
  '„Przywróć" po domknięciu nie wskrzesza dawnej zaufanej pary (a); treść domknięcia = treść wyzwalacza wypisu');

-- ── 7. ACL ───────────────────────────────────────────────────────────────────
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text || ' -> ' || r
       FROM pg_proc p CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
      WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege(r, p.oid, 'EXECUTE')
        AND p.proname = ANY (ARRAY['_newsletter_doi_measurement_offer_state', '_email_measurement_expiry_text',
                                   '_email_measurement_close_on_opt_out', 'tg_crm_consent_log_measurement_opt_out',
                                   '_email_measurement_close_backfill']::name[]) $$,
  'ACL: nowe funkcje wewnętrzne i wyzwalacz bez EXECUTE dla anon, authenticated i service_role');
SELECT ok(
  has_function_privilege('service_role', 'public.newsletter_doi_measurement_state(text, uuid, text, text, timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role',
        'public.newsletter_doi_measurement_decide(text, uuid, text, text, timestamptz, boolean, text, text)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon', 'authenticated']) r
     CROSS JOIN unnest(ARRAY['public.email_measurement_state(uuid, uuid)',
                             'public.email_measurement_withdraw(uuid, uuid, text, text, text)',
                             'public.newsletter_measurement_confirm(uuid, uuid, text, text)',
                             'public.newsletter_measurement_claim(integer, text)']) f
     WHERE has_function_privilege(r, f, 'EXECUTE'))
  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_consent_log_measurement_opt_out'
                AND tgrelid = 'public.crm_consent_log'::regclass AND NOT tgisinternal AND tgenabled = 'O'),
  'ACL: RPC strony DOI, stanu, wycofania i próśb - wyłącznie service_role; wyzwalacz wycofania newsletter/marketing aktywny');

SELECT * FROM finish();
ROLLBACK;
