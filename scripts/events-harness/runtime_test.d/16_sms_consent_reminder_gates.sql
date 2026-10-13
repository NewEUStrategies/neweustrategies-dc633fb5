-- ============================================================================
-- 16_sms_consent_reminder_gates - ZGODA NA SMS I BRAMKI KANALOW PRZYPOMNIEN
-- (REG-09 / REG-10, migracje 20261012110100 i 20261012110200)
--
-- PO CO TEN PLIK ISTNIEJE
-- pgTAP (supabase/tests/event_registration_sms_consent_test.sql,
-- event_reminder_channel_gates_test.sql) przypina reguly na pelnym schemacie.
-- Ten plik sprawdza te same reguly na REPLAYU modulu: na cialach, ktore
-- dostaja wszystkie pozostale pliki harnessu (resolver klucza A1, kartoteka
-- osob, ustawienia organizatora), z kluczem z PRAWDZIWEGO generatora zapisu.
--
-- CO SPRAWDZA
--   1. `event_registration_set_channels` kluczem (gosc): wlaczenie SMS bez
--      zgody -> sms_consent_required, ze zgoda -> stempel via token; osoba bez
--      numeru -> phone_required; klucz po koncu wydarzenia -> manage_expired;
--      scisle typy; klucz drugiego najemcy -> not_found (kontrapunkt: wlasny
--      najemca dziala).
--   2. To samo po koncie (via account) i pisarz remind_*.
--   3. Zmiana cyfr numeru zdejmuje zgode, zmiana formatu - nie.
--   4. `event_registration_preferences`: podpowiedz 3 cyfr, bez numeru.
--   5. `_event_reminder_candidates`: notify_email=false -> brak kandydata
--      e-mail (KRYTERIUM REG-09), SMS tylko przy notify_sms AND remind_sms AND
--      stemplu.
--
-- CZEGO NIE SPRAWDZA: ACL i przypomnien o sesjach (pgTAP), wysylki (vitest).
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================
\echo '== 16 zgoda na SMS i bramki kanalow przypomnien (REG-09/REG-10) =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('16b16b16-16b1-46b1-86b1-16b16b16b16b', 'Tenant 16B (obcy najemca)', 't16b-sms');

INSERT INTO auth.users (id, email) VALUES
  ('16000000-0000-4000-8000-000000000001', 'konto.sms16@example.org');

-- E: start za 30 min, termin 60 min, SMS organizatora wlaczone. P: po koncu.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, timezone,
  status, registration_mode) VALUES
  ('16100000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'sms16-e',
   'SMS 16', 'SMS 16', now() + interval '30 minutes', NULL, 'UTC', 'published', 'form'),
  ('16100000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'sms16-po',
   'SMS 16 po', 'SMS 16 ended', now() - interval '2 days', now() - interval '1 hour', 'UTC', 'published', 'form'),
  ('16100000-0000-4000-8000-000000000003', '16b16b16-16b1-46b1-86b1-16b16b16b16b', 'sms16-b',
   'SMS 16 B', 'SMS 16 B', now() + interval '10 days', NULL, 'UTC', 'published', 'form');

INSERT INTO public.event_participant_settings
  (tenant_id, event_id, reminders_enabled, reminder_event_leads_minutes, reminder_sms_enabled) VALUES
  ('11111111-1111-1111-1111-111111111111', '16100000-0000-4000-8000-000000000001', true, '{60}', true);

CREATE TEMP TABLE s16 (k text PRIMARY KEY, reg uuid NOT NULL, person uuid NOT NULL, token text NOT NULL)
  ON COMMIT DROP;
GRANT SELECT ON s16 TO anon, authenticated;

-- Zgloszenie z kluczem z prawdziwego generatora; w bazie tylko jego sha256.
CREATE FUNCTION pg_temp.s16_reg(_k text, _tenant uuid, _event uuid, _phone text, _uid uuid,
                                _notify_email boolean)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_person uuid := gen_random_uuid();
  v_id uuid := gen_random_uuid();
  v_token text := public._event_new_qr_token();
BEGIN
  INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, phone)
  VALUES (v_person, _tenant, _uid, _k || '.sms16@example.org', 'Test', _k, _phone);
  INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status, registration_mode,
    payment_status, created_at, notify_email, manage_token_hash)
  VALUES (v_id, _tenant, _event, v_person, 'approved', 'form', 'not_required', now() - interval '2 days',
          _notify_email, encode(extensions.digest(v_token, 'sha256'), 'hex'));
  INSERT INTO s16 VALUES (_k, v_id, v_person, v_token);
  RETURN v_id;
END $$;

SELECT pg_temp.s16_reg('gosc', '11111111-1111-1111-1111-111111111111', '16100000-0000-4000-8000-000000000001',
                       '+48 600 100 200', NULL, true);
SELECT pg_temp.s16_reg('bez_numeru', '11111111-1111-1111-1111-111111111111', '16100000-0000-4000-8000-000000000001',
                       NULL, NULL, true);
SELECT pg_temp.s16_reg('konto', '11111111-1111-1111-1111-111111111111', '16100000-0000-4000-8000-000000000001',
                       '601 222 333', '16000000-0000-4000-8000-000000000001', true);
SELECT pg_temp.s16_reg('bez_maila', '11111111-1111-1111-1111-111111111111', '16100000-0000-4000-8000-000000000001',
                       NULL, NULL, false);
SELECT pg_temp.s16_reg('po_koncu', '11111111-1111-1111-1111-111111111111', '16100000-0000-4000-8000-000000000002',
                       '602 333 444', NULL, true);
SELECT pg_temp.s16_reg('obcy', '16b16b16-16b1-46b1-86b1-16b16b16b16b', '16100000-0000-4000-8000-000000000003',
                       '603 444 555', NULL, true);

-- ---------------------------------------------------------------------------
-- 1. Kluczem (gosc bez konta)
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT notify_sms FROM public.event_registrations WHERE id = (SELECT reg FROM s16 WHERE k = 'gosc')) IS FALSE,
  '16/REG-10: nowe zgloszenie ma SMS wylaczony (DEFAULT false - zgoda nie jest domyslna)');

SELECT pg_temp.act_as(NULL, NULL);
SELECT set_config('nes.public_tenant', '11111111-1111-1111-1111-111111111111', false);
SET ROLE anon;

SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_set_channels(%L::jsonb)',
         jsonb_build_object('manage_token', (SELECT token FROM s16 WHERE k = 'gosc'), 'notify_sms', true)),
  'sms_consent_required', '16/REG-10: wlaczenie SMS kluczem bez zgody odrzucone');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_set_channels(%L::jsonb)',
         jsonb_build_object('manage_token', (SELECT token FROM s16 WHERE k = 'gosc'),
                            'notify_sms', 'true', 'sms_consent', true)),
  'invalid_payload: notify_sms must be boolean', '16/scisle typy: napis "true" odrzucony');
SELECT pg_temp.assert(
  (SELECT (v->>'notify_sms')::boolean AND (v->>'remind_sms')::boolean AND v->>'sms_consent_via' = 'token'
     FROM (SELECT public.event_registration_set_channels(jsonb_build_object(
             'manage_token', (SELECT token FROM s16 WHERE k = 'gosc'),
             'notify_sms', true, 'remind_sms', true, 'sms_consent', true)) AS v) x),
  '16/REG-10: zgoda kluczem -> notify_sms i remind_sms, stempel via token');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_set_channels(%L::jsonb)',
         jsonb_build_object('manage_token', (SELECT token FROM s16 WHERE k = 'bez_numeru'),
                            'remind_sms', true, 'sms_consent', true)),
  'phone_required', '16/REG-10: zgoda bez numeru odrzucona (phone_required)');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_set_channels(%L::jsonb)',
         jsonb_build_object('manage_token', (SELECT token FROM s16 WHERE k = 'po_koncu'), 'notify_email', false)),
  'manage_expired', '16/REG-17: klucz po koncu wydarzenia -> manage_expired');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_set_channels(%L::jsonb)',
         jsonb_build_object('manage_token', (SELECT token FROM s16 WHERE k = 'obcy'), 'notify_email', false)),
  'not_found', '16/najemca: klucz zgloszenia obcego najemcy -> not_found');

SELECT pg_temp.assert(
  (SELECT (v->>'ok')::boolean AND v->>'phone_hint' = '200' AND NOT (v ? 'phone')
          AND v::text NOT LIKE '%600 100%' AND (v->>'reminder_sms_enabled')::boolean
     FROM (SELECT public.event_registration_preferences(
             jsonb_build_object('manage_token', (SELECT token FROM s16 WHERE k = 'gosc'))) AS v) x),
  '16/preferencje: podpowiedz 3 ostatnich cyfr, bez numeru, flaga SMS organizatora');
SELECT pg_temp.assert(
  public.event_registration_preferences(
    jsonb_build_object('manage_token', (SELECT token FROM s16 WHERE k = 'po_koncu'))) ->> 'reason' = 'expired',
  '16/preferencje: klucz po koncu wydarzenia -> reason expired');
RESET ROLE;

-- Kontrapunkt izolacji: ten sam klucz obcego zgloszenia DZIALA u jego najemcy.
SELECT set_config('nes.public_tenant', '16b16b16-16b1-46b1-86b1-16b16b16b16b', false);
SET ROLE anon;
SELECT pg_temp.assert(
  public.event_registration_set_channels(jsonb_build_object(
    'manage_token', (SELECT token FROM s16 WHERE k = 'obcy'), 'notify_email', false)) ->> 'notify_email' = 'false',
  '16/najemca: kontrapunkt - klucz dziala pod hostem wlasnego najemcy');
RESET ROLE;
SELECT set_config('nes.public_tenant', '11111111-1111-1111-1111-111111111111', false);

-- ---------------------------------------------------------------------------
-- 2. Po koncie
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('16000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  public.event_registration_set_channels(jsonb_build_object(
    'registration_id', (SELECT reg FROM s16 WHERE k = 'konto'), 'remind_sessions', false)) ->> 'remind_sessions' = 'false',
  '16/REG-09: remind_sessions ma pisarza (konto)');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_set_channels(%L::jsonb)',
         jsonb_build_object('registration_id', (SELECT reg FROM s16 WHERE k = 'konto'), 'notify_sms', true)),
  'sms_consent_required', '16/REG-10: konto bez zgody -> sms_consent_required');
SELECT pg_temp.assert(
  public.event_registration_set_channels(jsonb_build_object(
    'registration_id', (SELECT reg FROM s16 WHERE k = 'konto'), 'notify_sms', true, 'sms_consent', true))
    ->> 'sms_consent_via' = 'account',
  '16/REG-10: zgoda po koncie -> stempel via account');
SELECT pg_temp.assert_raises_like(
  format('SELECT public.event_registration_set_channels(%L::jsonb)',
         jsonb_build_object('registration_id', (SELECT reg FROM s16 WHERE k = 'gosc'), 'notify_email', false)),
  'not_found', '16/konto: cudze zgloszenie (osoba bez konta) -> not_found');
RESET ROLE;
SELECT pg_temp.act_as(NULL, NULL);

-- ---------------------------------------------------------------------------
-- 3. Zgoda zwiazana z numerem
-- ---------------------------------------------------------------------------
UPDATE public.event_people SET phone = '601-222-333' WHERE id = (SELECT person FROM s16 WHERE k = 'konto');
SELECT pg_temp.assert(
  (SELECT notify_sms AND remind_sms_consent_at IS NOT NULL
     FROM public.event_registrations WHERE id = (SELECT reg FROM s16 WHERE k = 'konto')),
  '16/numer: zmiana formatu zostawia zgode');
UPDATE public.event_people SET phone = '601 222 334' WHERE id = (SELECT person FROM s16 WHERE k = 'konto');
SELECT pg_temp.assert(
  (SELECT NOT notify_sms AND NOT remind_sms AND remind_sms_consent_at IS NULL
     FROM public.event_registrations WHERE id = (SELECT reg FROM s16 WHERE k = 'konto')),
  '16/REG-10: zmiana cyfr numeru zdejmuje zgode i oba przelaczniki SMS');
SELECT pg_temp.assert(
  (SELECT notify_sms AND remind_sms FROM public.event_registrations WHERE id = (SELECT reg FROM s16 WHERE k = 'gosc')),
  '16/numer: zgoda innej osoby zostaje');

-- ---------------------------------------------------------------------------
-- 4. Bramki kanalow przypomnien
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.s16_cand(_k text, _channel text) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
    FROM public._event_reminder_candidates(now(), ARRAY['email', 'inapp', 'sms'], 1000) c
   WHERE c.registration_id = (SELECT reg FROM s16 WHERE k = _k) AND c.channel = _channel
$$;

SELECT pg_temp.assert(pg_temp.s16_cand('bez_maila', 'email') = 0,
  '16/REG-09 KRYTERIUM: notify_email=false -> brak kandydata e-mail');
SELECT pg_temp.assert(pg_temp.s16_cand('gosc', 'email') = 1,
  '16/REG-09: kontrapunkt - notify_email=true -> kandydat e-mail');
SELECT pg_temp.assert(pg_temp.s16_cand('gosc', 'sms') = 1,
  '16/REG-09: SMS przy notify_sms AND remind_sms AND stemplu -> kandydat');
SELECT pg_temp.assert(pg_temp.s16_cand('konto', 'sms') = 0,
  '16/REG-09: po zmianie numeru (zgoda zdjeta) brak kandydata SMS');
UPDATE public.event_registrations SET notify_sms = false WHERE id = (SELECT reg FROM s16 WHERE k = 'gosc');
SELECT pg_temp.assert(pg_temp.s16_cand('gosc', 'sms') = 0,
  '16/REG-09: notify_sms=false gasi przypomnienie SMS mimo remind_sms i stempla');

SELECT set_config('nes.public_tenant', '', false);
ROLLBACK;
