-- ============================================================================
-- 23_consent_ledger - REJESTR ZGOD UCZESTNIKOW (REG-02 / REG-14)
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracje 20261012130600..130800 robia z czterech stempli zgod w
-- `event_people` PROJEKCJE ksiegi append-only `event_consent_records`
-- (teksty wersjonowane, linki double opt-in, wycofanie do CRM). Pelny dowod
-- siedzi w supabase/tests/event_consent_ledger_test.sql (pgTAP, pelny
-- schemat); tu te same obietnice wykonujemy na KSZTALCIE MODULU z harnessu -
-- z jego atrapami CRM (`crm_leads`, `crm_consent_log`, `crm_upsert_from_form`)
-- i z jego mostem, ktory wola 14_crm_bridge, 28_ads_funnel, 42_cfp i 50_onsite.
--
-- CZEGO TU DOWODZIMY
--   (a) granty: funkcje rejestru tylko serwer, ksiega bez zapisu klienta,
--       linki DOI niewidoczne;
--   (b) ksiega append-only i CHECK zweryfikowanego udzielenia (formularz nie
--       udzieli marketingu - takze przez funkcje rejestru);
--   (c) kanal konta projektuje zgode, ale nie zdejmuje globalnego wycofania;
--   (d) DOI: token 32 znaki, w bazie tylko sha256, nowy zastepuje stary;
--       potwierdzenie zdejmuje wycofanie i NIE wskrzesza celu spoza linku;
--   (e) wycofanie kluczem samoobslugi: projekcja, `consent_withdrawn_at`,
--       zastapione linki, CRM `marketing_consent = false` + given=false;
--   (f) KRYTERIUM REG-14: most CRM po wycofaniu nie przywraca zgody - takze
--       gdy stary pisarz znow postawi stempel;
--   (g) spadek `legacy_single_opt_in` jest dowodem dla mostu;
--   (h) RLS ksiegi: wlasciciel swoje, admin najemcy swoje, inni nic.
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 23 rejestr zgod: ksiega, DOI, wycofanie do CRM =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('23000000-0000-0000-0000-0000000000b0', 'Tenant 23 B', 't23b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('23a00000-0000-0000-0000-0000000000a1', 'zgody.wlasciciel@example.org'),
  ('23a00000-0000-0000-0000-0000000000a2', 'zgody.admin@example.org'),
  ('23a00000-0000-0000-0000-0000000000a3', 'zgody.obcy@example.org')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('23a00000-0000-0000-0000-0000000000a2', 'admin', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('23a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Wlasciciel 23', 'zgody-wlasciciel'),
  ('23a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Admin 23', 'zgody-admin'),
  ('23a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Obcy 23', 'zgody-obcy')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('23e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'zgody-23', 'Forum 23', 'Forum 23', now() + interval '30 days', 'published')
ON CONFLICT (id) DO NOTHING;

-- p1 wlasciciel konta; p2 wycofal wszystko (stary stempel partnerow obok
-- wycofania - ksztalt danych sprzed ksiegi); p3 zgody sprzed ksiegi i kontakt
-- CRM z wylaczona zgoda; p9 w najemcy B.
INSERT INTO public.event_people
  (id, tenant_id, user_id, email, first_name, last_name, consent_data_processing_at,
   consent_marketing_at, consent_partner_sharing_at, consent_withdrawn_at, source)
VALUES
  ('23f00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '23a00000-0000-0000-0000-0000000000a1', 'zgody.wlasciciel@example.org', 'Wanda', 'Wlascicielka',
   now(), NULL, NULL, NULL, 'self_registration'),
  ('23f00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   NULL, 'zgody.wycofana@example.org', 'Wiesia', 'Wycofana',
   now(), NULL, '2026-01-10 10:00+00', '2026-02-01 10:00+00', 'self_registration'),
  ('23f00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   NULL, 'zgody.spadek@example.org', 'Stefan', 'Spadek',
   now(), '2026-01-15 10:00+00', '2026-01-15 10:00+00', NULL, 'self_registration'),
  ('23f00000-0000-0000-0000-000000000009', '23000000-0000-0000-0000-0000000000b0',
   NULL, 'zgody.b@example.org', 'Bogna', 'Obca',
   now(), NULL, NULL, NULL, 'self_registration')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, registration_mode) VALUES
  ('23d00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '23e00000-0000-0000-0000-0000000000e1', '23f00000-0000-0000-0000-000000000001', 'rsvp'),
  ('23d00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '23e00000-0000-0000-0000-0000000000e1', '23f00000-0000-0000-0000-000000000002', 'rsvp')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.crm_leads (tenant_id, email, marketing_consent) VALUES
  ('11111111-1111-1111-1111-111111111111', 'zgody.spadek@example.org', false);

-- ---------------------------------------------------------------------------
-- (a) granty
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_person_consents_confirm(uuid,uuid,text[],text,uuid,uuid,uuid,integer,text,text,text,uuid,text,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_person_consents_confirm(uuid,uuid,text[],text,uuid,uuid,uuid,integer,text,text,text,uuid,text,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_consent_issue_confirmation(uuid,uuid,text[],uuid,uuid,integer,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_person_consents_withdraw(uuid,uuid,text[],text,text,text,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_person_consent_crm_withdraw(uuid,uuid,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_consent_withdraw_by_email(uuid,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_person_consents_withdraw(uuid,uuid,text[],text,text,text,uuid,text)', 'EXECUTE'),
  '23/granty: funkcje rejestru tylko dla serwera');
SELECT pg_temp.assert(
  NOT has_table_privilege('authenticated', 'public.event_consent_records', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.event_consent_records', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.event_consent_records', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.event_consent_confirmations', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.event_consent_confirmations', 'SELECT'),
  '23/granty: ksiega bez zapisu klienta i bez poprawiania, linki DOI niewidoczne');

-- ---------------------------------------------------------------------------
-- (b)-(d) udzielenie, inwarianty, DOI
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_t   constant uuid := '11111111-1111-1111-1111-111111111111';
  v_p1  constant uuid := '23f00000-0000-0000-0000-000000000001';
  v_p2  constant uuid := '23f00000-0000-0000-0000-000000000002';
  v_ip  constant text := 'ip:' || repeat('23', 16);
  v_tok1 text;
  v_tok2 text;
  v_conf2 uuid;
  v_p record;
BEGIN
  -- Spadek dla p3 (zgody sprzed ksiegi); wycofana p2 pominieta.
  PERFORM public._event_consent_backfill_legacy();
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_consent_records
      WHERE person_id = '23f00000-0000-0000-0000-000000000003'
        AND status = 'confirmed' AND evidence = 'legacy_single_opt_in'
        AND created_at = '2026-01-15 10:00+00') = 2
    AND NOT EXISTS (SELECT 1 FROM public.event_consent_records WHERE person_id = v_p2),
    '23/spadek: aktywne stemple p3 jako legacy_single_opt_in, wycofana p2 pominieta');

  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public._event_person_consents_confirm(%L, %L, ARRAY['marketing'],
      'registration_form', NULL, NULL, NULL, 1, 'pl', NULL, NULL, NULL, 'registration_form')$q$, v_t, v_p1),
    'event_consent_records_verified_grant',
    '23/REG-02: marketing z samego formularza niemozliwy (CHECK ksiegi)');

  PERFORM public._event_person_consents_confirm(v_t, v_p1, ARRAY['marketing', 'partner_sharing'],
    'verified_account', NULL, '23d00000-0000-0000-0000-000000000001', NULL, 1, 'pl',
    v_ip, 'harness/23', '23a00000-0000-0000-0000-0000000000a1', 'registration_form');
  SELECT * INTO v_p FROM public.event_people WHERE id = v_p1;
  PERFORM pg_temp.assert(v_p.consent_marketing_at IS NOT NULL AND v_p.consent_partner_sharing_at IS NOT NULL,
    '23/konto: zweryfikowany wlasciciel - projekcja obu celow');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_consent_records
      WHERE person_id = v_p1 AND status = 'confirmed' AND evidence = 'verified_account'
        AND ip_subject = v_ip AND user_agent = 'harness/23' AND text_version = 1
        AND event_id = '23e00000-0000-0000-0000-0000000000e1') = 2,
    '23/konto: wpisy ksiegi z tekstem, IP i UA z serwera, wydarzenie ze zgloszenia');

  PERFORM pg_temp.assert_raises_like(
    $q$UPDATE public.event_consent_records SET status = 'withdrawn'
        WHERE person_id = '23f00000-0000-0000-0000-000000000001'$q$,
    'append_only', '23/ksiega: UPDATE wpisu odrzucony (append-only)');

  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public._event_person_consents_confirm(%L, %L, ARRAY['marketing'],
      'verified_account', NULL, NULL, NULL, 1, 'pl', NULL, NULL, NULL, NULL)$q$, v_t, v_p2),
    'consent_withdrawn_requires_reconfirmation',
    '23/konto: zaznaczenie pola nie zdejmuje globalnego wycofania');

  v_tok1 := public._event_consent_issue_confirmation(v_t, v_p2, ARRAY['marketing'], NULL,
    '23d00000-0000-0000-0000-000000000002', 1, 'pl', v_ip, 'harness/23');
  PERFORM pg_temp.assert(v_tok1 ~ '^[A-Za-z0-9_-]{32}$', '23/DOI: jawny token 32 znaki');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.event_consent_confirmations
             WHERE token_hash = encode(extensions.digest(v_tok1, 'sha256'), 'hex')
               AND strpos(token_hash, v_tok1) = 0)
    AND (SELECT count(*) FROM public.event_consent_records
          WHERE person_id = v_p2 AND status = 'pending' AND evidence = 'registration_form') = 1,
    '23/DOI: w bazie tylko skrot tokenu, wpis pending z formularza');

  v_tok2 := public._event_consent_issue_confirmation(v_t, v_p2, ARRAY['marketing'], NULL,
    '23d00000-0000-0000-0000-000000000002', 1, 'pl', v_ip, 'harness/23');
  PERFORM pg_temp.assert(
    (SELECT superseded_at IS NOT NULL FROM public.event_consent_confirmations
      WHERE token_hash = encode(extensions.digest(v_tok1, 'sha256'), 'hex'))
    AND (SELECT count(*) FROM public.event_consent_confirmations
          WHERE person_id = v_p2 AND confirmed_at IS NULL AND superseded_at IS NULL) = 1,
    '23/DOI: nowy link zastepuje poprzedni');

  UPDATE public.event_consent_confirmations
     SET confirmed_at = now(), confirmed_ip_subject = v_ip
   WHERE token_hash = encode(extensions.digest(v_tok2, 'sha256'), 'hex')
  RETURNING id INTO v_conf2;
  PERFORM public._event_person_consents_confirm(v_t, v_p2, ARRAY['marketing'], 'email_double_opt_in',
    NULL, '23d00000-0000-0000-0000-000000000002', v_conf2, NULL, NULL, v_ip, 'harness/23', NULL,
    'email_double_opt_in');
  SELECT * INTO v_p FROM public.event_people WHERE id = v_p2;
  PERFORM pg_temp.assert(
    v_p.consent_withdrawn_at IS NULL AND v_p.consent_marketing_at IS NOT NULL
    AND v_p.consent_partner_sharing_at IS NULL,
    '23/DOI: wycofanie zdjete, stary stempel partnerow (spoza linku) NIE wraca');

  -- Dane przyslane przez niezweryfikowanego zapisujacego: obiekt, <= 4000.
  UPDATE public.event_registrations
     SET submitted_profile = '{"last_name":"Podszywacz"}'::jsonb
   WHERE id = '23d00000-0000-0000-0000-000000000002';
  PERFORM pg_temp.assert_raises_like(
    $q$UPDATE public.event_registrations SET submitted_profile = '[1]'::jsonb
        WHERE id = '23d00000-0000-0000-0000-000000000002'$q$,
    'event_registrations_submitted_profile_shape',
    '23/submitted_profile: tylko obiekt jsonb');
  PERFORM pg_temp.assert_raises_like(
    $q$UPDATE public.event_registrations
          SET submitted_profile = jsonb_build_object('company_text', repeat('x', 4000))
        WHERE id = '23d00000-0000-0000-0000-000000000002'$q$,
    'event_registrations_submitted_profile_shape',
    '23/submitted_profile: ponad 4000 znakow odrzucone');
END
$do$;

-- ---------------------------------------------------------------------------
-- (e)-(g) wycofanie i most CRM
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_t   constant uuid := '11111111-1111-1111-1111-111111111111';
  v_p3  constant uuid := '23f00000-0000-0000-0000-000000000003';
  v_ip  constant text := 'ip:' || repeat('3d', 16);
  v_tok text;
  v_lead uuid;
  v_p record;
BEGIN
  v_lead := public._event_person_crm_sync(v_t, v_p3, 'event_participant', 'event:zgody-23:registration',
    ARRAY['event:zgody-23']);
  PERFORM pg_temp.assert(v_lead IS NOT NULL
    AND (SELECT marketing_consent FROM public.crm_leads WHERE id = v_lead)
    AND EXISTS (SELECT 1 FROM public.crm_consent_log
                 WHERE lower(email) = 'zgody.spadek@example.org' AND given
                   AND form_name = 'evidence:legacy_single_opt_in'),
    '23/most: spadek legacy jest dowodem zgody (kontakt false -> true)');

  v_tok := public._event_consent_issue_confirmation(v_t, v_p3, ARRAY['partner_sharing'],
    '23e00000-0000-0000-0000-0000000000e1', NULL, 1, 'en', NULL, NULL);

  PERFORM pg_temp.assert(
    public._event_person_consents_withdraw(v_t, v_p3, ARRAY['marketing', 'partner_sharing'],
      'manage_token', v_ip, 'harness/23', NULL, 'manage_token'),
    '23/wycofanie: kluczem samoobslugi, bylo co wycofac');
  SELECT * INTO v_p FROM public.event_people WHERE id = v_p3;
  PERFORM pg_temp.assert(
    v_p.consent_marketing_at IS NULL AND v_p.consent_partner_sharing_at IS NULL
    AND v_p.consent_withdrawn_at IS NOT NULL,
    '23/wycofanie: projekcja wyzerowana, consent_withdrawn_at ustawione');
  PERFORM pg_temp.assert(
    (SELECT superseded_at IS NOT NULL FROM public.event_consent_confirmations
      WHERE token_hash = encode(extensions.digest(v_tok, 'sha256'), 'hex')),
    '23/wycofanie: otwarty link DOI z wycofanym celem zastapiony');
  PERFORM pg_temp.assert(
    NOT (SELECT marketing_consent FROM public.crm_leads WHERE id = v_lead)
    AND EXISTS (SELECT 1 FROM public.crm_consent_log
                 WHERE lower(email) = 'zgody.spadek@example.org' AND NOT given
                   AND consent_key = 'marketing' AND source_type = 'event'
                   AND form_id = 'event_consent:manage_token' AND ip = v_ip),
    '23/REG-14: wycofanie dociera do CRM (marketing_consent false + given=false)');

  v_lead := public._event_person_crm_sync(v_t, v_p3, 'event_participant', 'event:zgody-23:checkin',
    ARRAY['event:zgody-23'], '{}'::jsonb, false);
  PERFORM pg_temp.assert(v_lead IS NOT NULL
    AND NOT (SELECT marketing_consent FROM public.crm_leads WHERE id = v_lead),
    '23/REG-14: most po wycofaniu nie przywraca zgody');

  -- Stary pisarz (event_register sprzed przepiecia) stawia stempel znowu.
  UPDATE public.event_people SET consent_marketing_at = now(), consent_withdrawn_at = NULL WHERE id = v_p3;
  v_lead := public._event_person_crm_sync(v_t, v_p3, 'event_participant', 'event:zgody-23:registration',
    ARRAY['event:zgody-23']);
  PERFORM pg_temp.assert(v_lead IS NOT NULL
    AND NOT (SELECT marketing_consent FROM public.crm_leads WHERE id = v_lead)
    AND (SELECT count(*) FROM public.crm_consent_log
          WHERE lower(email) = 'zgody.spadek@example.org' AND given) = 1,
    '23/REG-14: stempel postawiony obok ksiegi nie wskrzesza zgody w CRM');

  PERFORM pg_temp.assert(
    NOT public._event_person_consents_withdraw('23000000-0000-0000-0000-0000000000b0', v_p3,
      ARRAY['marketing'], 'manage_token', NULL, NULL, NULL, NULL),
    '23/izolacja: osoba najemcy A nie istnieje dla najemcy B');
END
$do$;

-- Wpis w najemcy B (do asercji RLS).
SELECT public._event_person_consents_confirm(
  '23000000-0000-0000-0000-0000000000b0', '23f00000-0000-0000-0000-000000000009',
  ARRAY['data_processing'], 'registration_form', NULL, NULL, NULL, 1, 'pl',
  NULL, NULL, NULL, 'registration_form');

-- ---------------------------------------------------------------------------
-- (h) RLS ksiegi
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('23a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.event_consent_records WHERE person_id = '23f00000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE person_id <> '23f00000-0000-0000-0000-000000000001'),
  '23/RLS: osoba z kontem czyta wylacznie wlasna ksiege');
SELECT pg_temp.assert_raises_like(
  $q$SELECT 1 FROM public.event_consent_confirmations$q$,
  'permission denied', '23/RLS: linki DOI niewidoczne dla klienta');
RESET ROLE;

SELECT pg_temp.act_as('23a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.event_consent_records WHERE person_id = '23f00000-0000-0000-0000-000000000003')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE tenant_id = '23000000-0000-0000-0000-0000000000b0'),
  '23/RLS: admin najemcy A czyta ksiege swoich osob, nie najemcy B');
RESET ROLE;

SELECT pg_temp.act_as('23a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_consent_records) = 0,
  '23/RLS: konto bez osoby i bez roli nie widzi zadnego wpisu');
RESET ROLE;

SELECT pg_temp.act_as();

ROLLBACK;
