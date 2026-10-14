-- pgTAP: przypomnienia respektuja glowne przelaczniki kanalow zgloszenia
-- (REG-09, migracja 20261012131200_event_reminder_channel_gates).
--
-- KRYTERIUM AUDYTU REG-09: „notify_email=false -> brak kandydata e-mail".
-- Dotyczy przypomnienia o WYDARZENIU i o SESJI; dzwonek (inapp) zostaje, bo
-- ma wlasna preferencje. SMS jest kandydatem tylko przy notify_sms AND
-- remind_sms AND stemplu zgody (REG-10: notify_sms bez zgody nie istnieje).
--
-- Czas: chwile wzgledne wobec now() (stalej w transakcji). Termin 60 min
-- i sesja 15 min nie podlegaja ciszy nocnej (> 60), wiec wynik nie zalezy
-- od godziny uruchomienia.
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test event_reminder_channel_gates
BEGIN;
SELECT plan(16);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('5e0a0000-0000-0000-0000-0000000000aa', 'rcg-a', 'Reminder gates A', 'rcg-a.example');

INSERT INTO auth.users (id, email) VALUES
  ('5e000000-0000-0000-0000-0000000000a1', 'rcg-muted-email@example.org'),
  ('5e000000-0000-0000-0000-0000000000a2', 'rcg-session-muted@example.org'),
  ('5e000000-0000-0000-0000-0000000000a3', 'rcg-session-open@example.org');

INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT u.id, u.email, split_part(u.email, '@', 1), '5e0a0000-0000-0000-0000-0000000000aa'
  FROM auth.users u
 WHERE u.id::text LIKE '5e000000-%';

-- E: start za 30 min, termin 60 min (nalezny), SMS organizatora wlaczone.
-- F: trwa, sesja S1 za 10 min (domyslny termin sesji 15 min).
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, timezone, status) VALUES
  ('5e100000-0000-0000-0000-000000000001', '5e0a0000-0000-0000-0000-0000000000aa', 'rcg-e',
   'Bramki E', 'Gates E', now() + interval '30 minutes', NULL, 'UTC', 'published'),
  ('5e100000-0000-0000-0000-000000000002', '5e0a0000-0000-0000-0000-0000000000aa', 'rcg-f',
   'Bramki F', 'Gates F', now() - interval '1 day', now() + interval '1 day', 'UTC', 'published');

INSERT INTO public.event_participant_settings
  (tenant_id, event_id, reminders_enabled, reminder_event_leads_minutes, reminder_sms_enabled) VALUES
  ('5e0a0000-0000-0000-0000-0000000000aa', '5e100000-0000-0000-0000-000000000001', true, '{60}', true);

INSERT INTO public.event_sessions (id, tenant_id, event_id, title_pl, title_en, starts_at, ends_at, status) VALUES
  ('5e200000-0000-0000-0000-000000000001', '5e0a0000-0000-0000-0000-0000000000aa',
   '5e100000-0000-0000-0000-000000000002', 'Panel', 'Panel',
   now() + interval '10 minutes', now() + interval '70 minutes', 'published');

INSERT INTO public.event_people (id, tenant_id, user_id, email, phone, first_name, last_name) VALUES
  ('5e300000-0000-0000-0000-00000000000a', '5e0a0000-0000-0000-0000-0000000000aa',
   '5e000000-0000-0000-0000-0000000000a1', 'rcg-muted-email@example.org', NULL, 'Anna', 'Bez Maila'),
  ('5e300000-0000-0000-0000-00000000000b', '5e0a0000-0000-0000-0000-0000000000aa',
   NULL, 'rcg-open@example.org', NULL, 'Bartek', 'Otwarty'),
  ('5e300000-0000-0000-0000-00000000000c', '5e0a0000-0000-0000-0000-0000000000aa',
   NULL, 'rcg-no-remind@example.org', NULL, 'Cezary', 'Bez Przypomnien'),
  ('5e300000-0000-0000-0000-00000000000d', '5e0a0000-0000-0000-0000-0000000000aa',
   NULL, 'rcg-sms-off@example.org', '+48600100201', 'Dorota', 'Sms Wylaczony'),
  ('5e300000-0000-0000-0000-00000000000e', '5e0a0000-0000-0000-0000-0000000000aa',
   NULL, 'rcg-sms-on@example.org', '+48600100202', 'Ela', 'Sms Wlaczony'),
  ('5e300000-0000-0000-0000-00000000000f', '5e0a0000-0000-0000-0000-0000000000aa',
   NULL, 'rcg-sms-channel-only@example.org', '+48600100203', 'Filip', 'Tylko Kanal'),
  ('5e300000-0000-0000-0000-000000000010', '5e0a0000-0000-0000-0000-0000000000aa',
   '5e000000-0000-0000-0000-0000000000a2', 'rcg-session-muted@example.org', NULL, 'Sara', 'Sesja Bez Maila'),
  ('5e300000-0000-0000-0000-000000000011', '5e0a0000-0000-0000-0000-0000000000aa',
   '5e000000-0000-0000-0000-0000000000a3', 'rcg-session-open@example.org', NULL, 'Szymon', 'Sesja Z Mailem');

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, registration_mode, status, payment_status, created_at,
   notify_email, notify_sms, remind_email, remind_push, remind_sms, remind_sms_consent_at, remind_sms_consent_via) VALUES
  -- A: wylaczyl e-mail na zgloszeniu, podprzelacznik przypomnien zostal true.
  ('5e400000-0000-0000-0000-00000000000a', '5e0a0000-0000-0000-0000-0000000000aa', '5e100000-0000-0000-0000-000000000001',
   '5e300000-0000-0000-0000-00000000000a', 'form', 'approved', 'not_required', now() - interval '2 days',
   false, false, true, true, false, NULL, NULL),
  -- B: kontrapunkt - oba przelaczniki e-mail wlaczone.
  ('5e400000-0000-0000-0000-00000000000b', '5e0a0000-0000-0000-0000-0000000000aa', '5e100000-0000-0000-0000-000000000001',
   '5e300000-0000-0000-0000-00000000000b', 'form', 'approved', 'not_required', now() - interval '2 days',
   true, false, true, true, false, NULL, NULL),
  -- C: kanal wlaczony, przypomnienia e-mail wylaczone.
  ('5e400000-0000-0000-0000-00000000000c', '5e0a0000-0000-0000-0000-0000000000aa', '5e100000-0000-0000-0000-000000000001',
   '5e300000-0000-0000-0000-00000000000c', 'form', 'approved', 'not_required', now() - interval '2 days',
   true, false, false, true, false, NULL, NULL),
  -- D: zgoda i remind_sms, ale kanal SMS wylaczony.
  ('5e400000-0000-0000-0000-00000000000d', '5e0a0000-0000-0000-0000-0000000000aa', '5e100000-0000-0000-0000-000000000001',
   '5e300000-0000-0000-0000-00000000000d', 'form', 'approved', 'not_required', now() - interval '2 days',
   true, false, true, true, true, now() - interval '2 days', 'token'),
  -- E2: kanal, przypomnienia SMS i zgoda - jedyny kandydat SMS.
  ('5e400000-0000-0000-0000-00000000000e', '5e0a0000-0000-0000-0000-0000000000aa', '5e100000-0000-0000-0000-000000000001',
   '5e300000-0000-0000-0000-00000000000e', 'form', 'approved', 'not_required', now() - interval '2 days',
   true, true, true, true, true, now() - interval '2 days', 'account'),
  -- G: kanal SMS ze zgoda, ale przypomnienia SMS wylaczone.
  ('5e400000-0000-0000-0000-00000000000f', '5e0a0000-0000-0000-0000-0000000000aa', '5e100000-0000-0000-0000-000000000001',
   '5e300000-0000-0000-0000-00000000000f', 'form', 'approved', 'not_required', now() - interval '2 days',
   true, true, true, true, false, now() - interval '2 days', 'token'),
  -- S: bilet na F, e-mail wylaczony na zgloszeniu.
  ('5e400000-0000-0000-0000-000000000010', '5e0a0000-0000-0000-0000-0000000000aa', '5e100000-0000-0000-0000-000000000002',
   '5e300000-0000-0000-0000-000000000010', 'form', 'approved', 'not_required', now() - interval '3 days',
   false, false, true, true, false, NULL, NULL),
  -- S2: kontrapunkt sesji.
  ('5e400000-0000-0000-0000-000000000011', '5e0a0000-0000-0000-0000-0000000000aa', '5e100000-0000-0000-0000-000000000002',
   '5e300000-0000-0000-0000-000000000011', 'form', 'approved', 'not_required', now() - interval '3 days',
   true, false, true, true, false, NULL, NULL);

INSERT INTO public.event_session_saves (tenant_id, event_id, session_id, user_id, created_at) VALUES
  ('5e0a0000-0000-0000-0000-0000000000aa', '5e100000-0000-0000-0000-000000000002',
   '5e200000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-0000000000a2', now() - interval '1 day'),
  ('5e0a0000-0000-0000-0000-0000000000aa', '5e100000-0000-0000-0000-000000000002',
   '5e200000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-0000000000a3', now() - interval '1 day');

CREATE FUNCTION pg_temp.cand(p_reg uuid, p_channel text, p_kind text)
RETURNS integer LANGUAGE sql STABLE AS $fn$
  SELECT count(*)::int
    FROM public._event_reminder_candidates(now(), ARRAY['email', 'inapp', 'sms'], 1000) c
   WHERE c.registration_id = p_reg AND c.channel = p_channel AND c.kind = p_kind;
$fn$;

-- ── 1-4. E-mail o wydarzeniu ─────────────────────────────────────────────────
SELECT is(pg_temp.cand('5e400000-0000-0000-0000-00000000000a', 'email', 'event_reminder'), 0,
  'REG-09 KRYTERIUM: notify_email=false -> brak kandydata e-mail (przypomnienie o wydarzeniu)');
SELECT is(pg_temp.cand('5e400000-0000-0000-0000-00000000000b', 'email', 'event_reminder'), 1,
  'kontrapunkt: notify_email i remind_email -> jeden kandydat e-mail');
SELECT is(pg_temp.cand('5e400000-0000-0000-0000-00000000000c', 'email', 'event_reminder'), 0,
  'remind_email=false przy wlaczonym kanale -> brak kandydata e-mail');
SELECT is(pg_temp.cand('5e400000-0000-0000-0000-00000000000a', 'inapp', 'event_reminder'), 1,
  'notify_email=false nie gasi dzwonka (wlasna preferencja remind_push)');

-- ── 5-7. E-mail o sesji ──────────────────────────────────────────────────────
SELECT is(pg_temp.cand('5e400000-0000-0000-0000-000000000010', 'email', 'session_reminder'), 0,
  'REG-09 KRYTERIUM: notify_email=false -> brak kandydata e-mail (przypomnienie o sesji)');
SELECT is(pg_temp.cand('5e400000-0000-0000-0000-000000000010', 'inapp', 'session_reminder'), 1,
  'sesja: dzwonek zostaje przy wylaczonym e-mailu');
SELECT is(pg_temp.cand('5e400000-0000-0000-0000-000000000011', 'email', 'session_reminder'), 1,
  'kontrapunkt sesji: notify_email=true -> kandydat e-mail');

-- ── 8-10. SMS ────────────────────────────────────────────────────────────────
SELECT is(pg_temp.cand('5e400000-0000-0000-0000-00000000000d', 'sms', 'event_reminder'), 0,
  'SMS: notify_sms=false -> brak kandydata mimo remind_sms i zgody');
SELECT is(pg_temp.cand('5e400000-0000-0000-0000-00000000000e', 'sms', 'event_reminder'), 1,
  'SMS: notify_sms AND remind_sms AND stempel -> kandydat');
SELECT is(pg_temp.cand('5e400000-0000-0000-0000-00000000000f', 'sms', 'event_reminder'), 0,
  'SMS: kanal ze zgoda bez remind_sms -> brak kandydata');

-- ── 11-12. Partia zadania F2 ────────────────────────────────────────────────
CREATE TEMP TABLE claim ON COMMIT DROP AS
  SELECT x FROM jsonb_array_elements(public._event_reminders_claim(50, true)) AS x;
SELECT is(
  (SELECT count(*)::int FROM claim
    WHERE (x->>'registration_id' IN ('5e400000-0000-0000-0000-00000000000a',
                                     '5e400000-0000-0000-0000-00000000000c',
                                     '5e400000-0000-0000-0000-000000000010')
           AND x->>'channel' = 'email')
       OR (x->>'registration_id' IN ('5e400000-0000-0000-0000-00000000000d',
                                     '5e400000-0000-0000-0000-00000000000f')
           AND x->>'channel' = 'sms')), 0,
  'partia e-mail/SMS nie rezerwuje wyciszonych kanalow (A, C, S e-mail; D, G SMS)');
SELECT is(
  (SELECT string_agg(x->>'registration_id', ',') FROM claim WHERE x->>'channel' = 'sms'),
  '5e400000-0000-0000-0000-00000000000e',
  'partia SMS: wylacznie zgloszenie z kanalem, przypomnieniami SMS i zgoda');

-- ── 13-16. Cialo i ACL ────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int
     FROM regexp_matches(pg_get_functiondef('public._event_reminder_candidates(timestamptz, text[], integer)'::regprocedure),
                         'r\.notify_email AND r\.remind_email', 'g')), 2,
  'cialo: notify_email bramkuje e-mail o wydarzeniu i o sesji');
SELECT ok(
  pg_get_functiondef('public._event_reminder_candidates(timestamptz, text[], integer)'::regprocedure)
    LIKE '%r.notify_sms AND r.remind_sms AND r.remind_sms_consent_at IS NOT NULL%',
  'cialo: SMS wymaga notify_sms AND remind_sms AND stempla');
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_reminder_candidates(timestamptz, text[], integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_reminder_candidates(timestamptz, text[], integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_reminder_candidates(timestamptz, text[], integer)', 'EXECUTE'),
  'acl: skaner tylko dla service_role');
SELECT ok((
  SELECT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%pg_temp%')
    FROM pg_proc p
   WHERE p.oid = 'public._event_reminder_candidates(timestamptz, text[], integer)'::regprocedure),
  'search_path: przypieta sciezka z pg_temp');

SELECT * FROM finish();
ROLLBACK;
