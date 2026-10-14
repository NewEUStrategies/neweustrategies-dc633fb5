-- ============================================================================
-- 26_consent_confirm_withdraw - POTWIERDZENIE DOI, WYCOFANIE ZGOD I NABOR
-- PRZEZ POTWIERDZONY ADRES (REG-02 / REG-14, JEDNOSTKA B3)
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracje 20261012133000 i 20261012133100 domykaja rejestr zgod (A2): link
-- double opt-in z maila wreszcie POTWIERDZA zgody, wycofanie dziala kluczem
-- samoobslugi (takze wygaslym i po anulowaniu) i z konta, a nabor prelegentow
-- wiaze konto tylko przez potwierdzony adres i zapisuje marketing przez
-- ksiege. Pelny dowod (z linkiem wypisu z maila, ktorego tabel harness nie
-- ma) siedzi w supabase/tests/event_consent_confirm_withdraw_test.sql; tu te
-- same obietnice na KSZTALCIE MODULU z atrapami CRM harnessu.
--
-- CZEGO TU DOWODZIMY
--   (a) granty: podglad, potwierdzenie i wycofanie tylko dla serwera;
--   (b) podglad nie zmienia niczego i nie oddaje danych osobowych;
--   (c) potwierdzenie: projekcja, ksiega email_double_opt_in, CRM z tekstem
--       i wersja; drugi raz already; obcy najemca not_found; po terminie
--       i po zmianie adresu expired (link zastapiony);
--   (d) KRYTERIUM REG-14 „test odwolania, ktore przechodzi do CRM": klucz
--       samoobslugi -> projekcja, ksiega manage_token, CRM false + given=false,
--       most nie wskrzesza; odpowiedz stala niezaleznie od stanu;
--   (e) wycofanie z konta i kluczem wygaslym;
--   (f) stan zgod uczestnika i wglad organizatora;
--   (g) nabor: email_unverified, wiazanie przez potwierdzony adres, lepkie
--       wycofanie.
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 26 zgody: potwierdzenie DOI, wycofanie do CRM, nabor =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('26000000-0000-0000-0000-0000000000b0', 'Tenant 26 B', 't26b')
ON CONFLICT (id) DO NOTHING;

-- a1 wlasciciel osoby p_o; a2 admin; a3 konto bez potwierdzenia; a4 nabor;
-- a5 nabor osoby, ktora wycofala zgody.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('26a00000-0000-0000-0000-0000000000a1', 'zgody26.wlasciciel@example.org', now()),
  ('26a00000-0000-0000-0000-0000000000a2', 'zgody26.admin@example.org', now()),
  ('26a00000-0000-0000-0000-0000000000a3', 'zgody26.niepotwierdzone@example.org', NULL),
  ('26a00000-0000-0000-0000-0000000000a4', 'zgody26.nabor@example.org', now()),
  ('26a00000-0000-0000-0000-0000000000a5', 'zgody26.wycofana@example.org', now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('26a00000-0000-0000-0000-0000000000a2', 'admin', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('26a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Wlasciciel 26', 'zgody26-wlasciciel'),
  ('26a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Admin 26', 'zgody26-admin'),
  ('26a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Niepotwierdzone 26', 'zgody26-niepotw'),
  ('26a00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', 'Nabor 26', 'zgody26-nabor'),
  ('26a00000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', 'Wycofana 26', 'zgody26-wycofana')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('26e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'zgody-26', 'Forum 26', 'Forum 26', now() + interval '30 days', 'published'),
  ('26e00000-0000-0000-0000-0000000000e0', '11111111-1111-1111-1111-111111111111',
   'zgody-26-minione', 'Forum 26 minione', 'Past Forum 26', now() - interval '10 days', 'published')
ON CONFLICT (id) DO NOTHING;

-- p1 uczestnik bez zgod (dostanie link DOI); p_o dowiazana do a1 ze zgodami
-- sprzed ksiegi; p_n bez zgod; p_x zgloszenie na minione wydarzenie; p_e/p_c
-- linki po terminie i po zmianie adresu; p_w wycofala zgody (nabor);
-- p_b w najemcy B.
INSERT INTO public.event_people
  (id, tenant_id, user_id, email, first_name, last_name, consent_data_processing_at,
   consent_marketing_at, consent_partner_sharing_at, consent_withdrawn_at, source)
VALUES
  ('26f00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', NULL,
   'zgody26.uczestnik@example.org', 'Ula', 'Uczestniczka', now(), NULL, NULL, NULL, 'self_registration'),
  ('26f00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '26a00000-0000-0000-0000-0000000000a1', 'zgody26.wlasciciel@example.org', 'Olek', 'Wlasciciel',
   now(), '2026-01-02 10:00+00', '2026-01-02 10:00+00', NULL, 'self_registration'),
  ('26f00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', NULL,
   'zgody26.bez@example.org', 'Nina', 'Bezzgod', now(), NULL, NULL, NULL, 'self_registration'),
  ('26f00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', NULL,
   'zgody26.minione@example.org', 'Ewa', 'Minione', now(), '2026-01-02 10:00+00', NULL, NULL, 'self_registration'),
  ('26f00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', NULL,
   'zgody26.pozno@example.org', 'Leon', 'Pozny', now(), NULL, NULL, NULL, 'self_registration'),
  ('26f00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', NULL,
   'zgody26.zmiana@example.org', 'Cezary', 'Zmiana', now(), NULL, NULL, NULL, 'self_registration'),
  ('26f00000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', NULL,
   'zgody26.wycofana@example.org', 'Wanda', 'Wycofana', now(), NULL, NULL, '2026-02-01 10:00+00', 'self_registration'),
  ('26f00000-0000-0000-0000-000000000009', '26000000-0000-0000-0000-0000000000b0', NULL,
   'zgody26.b@example.org', 'Bogna', 'Obca', now(), NULL, NULL, NULL, 'self_registration')
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE t26 (k text PRIMARY KEY, v text);
INSERT INTO t26 (k, v) VALUES
  ('m_p1', 'Z26uczestnik' || repeat('u', 20)),
  ('m_po', 'Z26wlasciciel' || repeat('o', 19)),
  ('m_pn', 'Z26bez' || repeat('n', 26)),
  ('m_px', 'Z26minione' || repeat('x', 22)),
  ('m_unknown', 'Z26nieznany' || repeat('q', 21));

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, registration_mode, manage_token_hash) VALUES
  ('26d00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '26e00000-0000-0000-0000-0000000000e1', '26f00000-0000-0000-0000-000000000001', 'rsvp',
   encode(extensions.digest((SELECT v FROM t26 WHERE k = 'm_p1'), 'sha256'), 'hex')),
  ('26d00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '26e00000-0000-0000-0000-0000000000e1', '26f00000-0000-0000-0000-000000000002', 'rsvp',
   encode(extensions.digest((SELECT v FROM t26 WHERE k = 'm_po'), 'sha256'), 'hex')),
  ('26d00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '26e00000-0000-0000-0000-0000000000e1', '26f00000-0000-0000-0000-000000000003', 'rsvp',
   encode(extensions.digest((SELECT v FROM t26 WHERE k = 'm_pn'), 'sha256'), 'hex')),
  ('26d00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '26e00000-0000-0000-0000-0000000000e0', '26f00000-0000-0000-0000-000000000004', 'rsvp',
   encode(extensions.digest((SELECT v FROM t26 WHERE k = 'm_px'), 'sha256'), 'hex'))
ON CONFLICT (id) DO NOTHING;

UPDATE public.event_registrations SET submitted_profile = '{"last_name":"Podszywacz"}'::jsonb
 WHERE id = '26d00000-0000-0000-0000-000000000001';

INSERT INTO public.crm_leads (tenant_id, email, marketing_consent) VALUES
  ('11111111-1111-1111-1111-111111111111', 'zgody26.uczestnik@example.org', false),
  ('11111111-1111-1111-1111-111111111111', 'zgody26.wlasciciel@example.org', true);

-- ---------------------------------------------------------------------------
-- (a) granty
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.event_consent_confirmation_preview(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_consent_confirmation_preview(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_consent_confirm_for_request(uuid,uuid,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_consent_confirm_for_request(uuid,uuid,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_consent_withdraw_for_request(uuid,uuid,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_consent_withdraw_for_request(uuid,uuid,text,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_consent_withdraw_for_request(uuid,uuid,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_my_consent_state()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_registration_consent_detail(uuid)', 'EXECUTE'),
  '26/granty: podglad, potwierdzenie i wycofanie tylko serwer; stan i wglad bez anon');

-- ---------------------------------------------------------------------------
-- (b)-(c) podglad i potwierdzenie linku
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_t   constant uuid := '11111111-1111-1111-1111-111111111111';
  v_tb  constant uuid := '26000000-0000-0000-0000-0000000000b0';
  v_p1  constant uuid := '26f00000-0000-0000-0000-000000000001';
  v_ip  constant text := 'ip:' || repeat('26', 16);
  v_tok text;
  v_late text;
  v_changed text;
  v jsonb;
BEGIN
  v_tok := public._event_consent_issue_confirmation(v_t, v_p1, ARRAY['marketing', 'partner_sharing'],
    NULL, '26d00000-0000-0000-0000-000000000001', 1, 'pl', v_ip, 'harness/26');
  INSERT INTO t26 VALUES ('doi', v_tok);

  v := public.event_consent_confirmation_preview(v_t, v_tok);
  PERFORM pg_temp.assert(
    v->>'state' = 'open' AND v->'purposes' = '["marketing", "partner_sharing"]'::jsonb
    AND jsonb_array_length(v->'texts') = 2 AND v::text !~* 'uczestni|example\.org',
    '26/podglad: open, cele, teksty - bez adresu i nazwiska');
  PERFORM pg_temp.assert(
    (SELECT consent_marketing_at IS NULL FROM public.event_people WHERE id = v_p1)
    AND (SELECT confirmed_at IS NULL FROM public.event_consent_confirmations WHERE person_id = v_p1),
    '26/podglad niczego nie zmienia (skaner poczty nie potwierdzi zgody)');

  v := public.event_consent_confirm_for_request(v_tb, NULL, v_ip, 'harness/26', v_tok);
  PERFORM pg_temp.assert(v->>'state' = 'not_found', '26/potwierdzenie z obcego najemcy -> not_found');

  v := public.event_consent_confirm_for_request(v_t, NULL, v_ip, 'harness/26-confirm', v_tok);
  PERFORM pg_temp.assert(v->>'state' = 'confirmed' AND (v->>'ok')::boolean,
    '26/potwierdzenie linku -> confirmed');
  PERFORM pg_temp.assert(
    (SELECT consent_marketing_at IS NOT NULL AND consent_partner_sharing_at IS NOT NULL
       FROM public.event_people WHERE id = v_p1)
    AND (SELECT count(*) FROM public.event_consent_records
          WHERE person_id = v_p1 AND status = 'confirmed' AND evidence = 'email_double_opt_in'
            AND user_agent = 'harness/26-confirm' AND ip_subject = v_ip) = 2,
    '26/DOI: projekcja obu celow i dwa wpisy ksiegi email_double_opt_in z IP i UA potwierdzenia');
  PERFORM pg_temp.assert(
    (SELECT marketing_consent FROM public.crm_leads
      WHERE tenant_id = v_t AND lower(email) = 'zgody26.uczestnik@example.org')
    AND EXISTS (SELECT 1 FROM public.crm_consent_log g
                 WHERE g.tenant_id = v_t AND lower(g.email) = 'zgody26.uczestnik@example.org'
                   AND g.given AND g.consent_version = 'event-marketing-v1-pl'
                   AND g.consent_text = (SELECT body FROM public.event_consent_texts
                                          WHERE purpose = 'marketing' AND version = 1 AND lang = 'pl')),
    '26/DOI: zgoda w CRM z prawdziwym tekstem i wersja event-marketing-v1-pl');
  v := public.event_consent_confirm_for_request(v_t, NULL, v_ip, 'harness/26', v_tok);
  PERFORM pg_temp.assert(v->>'state' = 'already', '26/drugie potwierdzenie -> already');

  -- Link po terminie i link na adres, ktorego osoba juz nie ma.
  v_late := public._event_consent_issue_confirmation(v_t, '26f00000-0000-0000-0000-000000000005',
    ARRAY['marketing'], NULL, NULL, 1, 'pl', NULL, NULL);
  UPDATE public.event_consent_confirmations
     SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
   WHERE person_id = '26f00000-0000-0000-0000-000000000005';
  v := public.event_consent_confirm_for_request(v_t, NULL, v_ip, 'harness/26', v_late);
  PERFORM pg_temp.assert(
    v->>'state' = 'expired'
    AND (SELECT superseded_at IS NOT NULL FROM public.event_consent_confirmations
          WHERE person_id = '26f00000-0000-0000-0000-000000000005'),
    '26/link po terminie -> expired i oznaczony jako zastapiony');

  v_changed := public._event_consent_issue_confirmation(v_t, '26f00000-0000-0000-0000-000000000006',
    ARRAY['marketing'], NULL, NULL, 1, 'pl', NULL, NULL);
  UPDATE public.event_people SET email = 'zgody26.nowy-adres@example.org'
   WHERE id = '26f00000-0000-0000-0000-000000000006';
  v := public.event_consent_confirm_for_request(v_t, NULL, v_ip, 'harness/26', v_changed);
  PERFORM pg_temp.assert(
    v->>'state' = 'expired'
    AND (SELECT consent_marketing_at IS NULL FROM public.event_people
          WHERE id = '26f00000-0000-0000-0000-000000000006'),
    '26/adres osoby zmieniony po wydaniu linku -> expired, bez zgody dla nowej skrzynki');

  PERFORM pg_temp.assert(
    (SELECT count FROM public.rate_limits
      WHERE scope = 'event_consent_confirm' AND subject_id = v_t::text || ':' || v_ip) = 4,
    '26/kubelek event_consent_confirm liczy kazda probe adresu w najemcy');
END
$do$;

-- ---------------------------------------------------------------------------
-- (d)-(e) wycofanie: klucz samoobslugi, konto, klucz wygasly
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_t   constant uuid := '11111111-1111-1111-1111-111111111111';
  v_p1  constant uuid := '26f00000-0000-0000-0000-000000000001';
  v_po  constant uuid := '26f00000-0000-0000-0000-000000000002';
  v_ip  constant text := 'ip:' || repeat('62', 16);
  v_a   jsonb;
  v_b   jsonb;
  v_c   jsonb;
  v_d   jsonb;
BEGIN
  v_a := public.event_consent_withdraw_for_request(v_t, NULL, v_ip, 'harness/26-withdraw',
    jsonb_build_object('manage_token', (SELECT v FROM t26 WHERE k = 'm_p1'), 'purposes', 'all'));
  PERFORM public._event_person_crm_sync(v_t, v_p1, 'event_participant', 'event:zgody-26:checkin',
    ARRAY['event:zgody-26'], '{}'::jsonb, true, 'event.checkin.attended', '{}'::jsonb);
  PERFORM pg_temp.assert(
    (SELECT consent_marketing_at IS NULL AND consent_partner_sharing_at IS NULL
            AND consent_withdrawn_at IS NOT NULL
       FROM public.event_people WHERE id = v_p1)
    AND (SELECT count(*) FROM public.event_consent_records
          WHERE person_id = v_p1 AND status = 'withdrawn' AND evidence = 'manage_token'
            AND ip_subject = v_ip AND user_agent = 'harness/26-withdraw') = 2,
    '26/wycofanie kluczem: projekcja pusta, consent_withdrawn_at, dwa wpisy manage_token');
  PERFORM pg_temp.assert(
    NOT (SELECT marketing_consent FROM public.crm_leads
          WHERE tenant_id = v_t AND lower(email) = 'zgody26.uczestnik@example.org')
    AND EXISTS (SELECT 1 FROM public.crm_consent_log g
                 WHERE g.tenant_id = v_t AND lower(g.email) = 'zgody26.uczestnik@example.org'
                   AND NOT g.given AND g.form_id = 'event_consent:manage_token')
    AND (SELECT count(*) FROM public.crm_consent_log g
          WHERE g.tenant_id = v_t AND lower(g.email) = 'zgody26.uczestnik@example.org' AND g.given) = 1,
    '26/REG-14: test odwolania, ktore przechodzi do CRM (false + given=false, most nie wskrzesza)');

  v_b := public.event_consent_withdraw_for_request(v_t, NULL, v_ip, 'harness/26-withdraw',
    jsonb_build_object('manage_token', (SELECT v FROM t26 WHERE k = 'm_pn'), 'purposes', 'all'));
  v_c := public.event_consent_withdraw_for_request(v_t, NULL, v_ip, 'harness/26-withdraw',
    jsonb_build_object('manage_token', (SELECT v FROM t26 WHERE k = 'm_unknown'), 'purposes', 'all'));
  v_d := public.event_consent_withdraw_for_request(v_t, NULL, v_ip, 'harness/26-withdraw',
    jsonb_build_object('purposes', 'all', 'person_id', v_po, 'email', 'zgody26.wlasciciel@example.org'));
  PERFORM pg_temp.assert(
    v_a = '{"ok": true}'::jsonb AND v_b = v_a AND v_c = v_a AND v_d = v_a,
    '26/odpowiedz wycofania stala: ze zgodami, bez zgod, nieznany klucz, same identyfikatory');
  PERFORM pg_temp.assert(
    (SELECT consent_marketing_at IS NOT NULL FROM public.event_people WHERE id = v_po)
    AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                     WHERE person_id = v_po AND status = 'withdrawn'),
    '26/identyfikator osoby i adres z ladunku ignorowane');

  PERFORM public.event_consent_withdraw_for_request(v_t, NULL, v_ip, 'harness/26-withdraw',
    jsonb_build_object('manage_token', (SELECT v FROM t26 WHERE k = 'm_px'),
                       'purposes', jsonb_build_array('marketing')));
  PERFORM pg_temp.assert(
    (SELECT consent_marketing_at IS NULL FROM public.event_people
      WHERE id = '26f00000-0000-0000-0000-000000000004'),
    '26/klucz wygasly (wydarzenie minelo) nadal wycofuje zgode');

  PERFORM public.event_consent_withdraw_for_request(v_t, '26a00000-0000-0000-0000-0000000000a1', v_ip,
    'harness/26-withdraw', jsonb_build_object('purposes', jsonb_build_array('marketing')));
  PERFORM pg_temp.assert(
    (SELECT consent_marketing_at IS NULL AND consent_partner_sharing_at IS NOT NULL
            AND consent_withdrawn_at IS NULL
       FROM public.event_people WHERE id = v_po)
    AND EXISTS (SELECT 1 FROM public.event_consent_records
                 WHERE person_id = v_po AND evidence = 'account_settings' AND status = 'withdrawn')
    AND NOT (SELECT marketing_consent FROM public.crm_leads
              WHERE tenant_id = v_t AND lower(email) = 'zgody26.wlasciciel@example.org'),
    '26/wycofanie z konta: tylko marketing, dowod account_settings, CRM false');
  PERFORM pg_temp.assert(
    public.event_consent_withdraw_for_request(v_t, NULL, v_ip, 'harness/26-withdraw',
      jsonb_build_object('purposes', 'data_processing')) = '{"ok": false, "error": "invalid_payload"}'::jsonb,
    '26/cel spoza listy -> invalid_payload');
END
$do$;

-- ---------------------------------------------------------------------------
-- (f) stan zgod uczestnika i wglad organizatora
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
BEGIN
  PERFORM pg_temp.act_as('26a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  v := public.event_my_consent_state();
  PERFORM pg_temp.assert(
    (v->>'linked')::boolean AND v->'consents'->>'marketing_at' IS NULL
    AND v->'ledger'->0->>'evidence' = 'account_settings' AND v::text !~ 'ip_subject|user_agent',
    '26/stan zgod uczestnika: osoba konta, najnowszy wpis pierwszy, bez IP i UA');

  PERFORM pg_temp.act_as('26a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
  v := public.admin_event_registration_consent_detail('26d00000-0000-0000-0000-000000000001');
  PERFORM pg_temp.assert(
    (v->>'differs')::boolean AND v->'differences' = '["last_name"]'::jsonb
    AND v->'current'->>'last_name' = 'Uczestniczka' AND jsonb_array_length(v->'ledger') >= 6,
    '26/wglad organizatora: dane z zapisu obok kartoteki i ksiega osoby');

  PERFORM pg_temp.act_as('26a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_registration_consent_detail('26d00000-0000-0000-0000-000000000001')$q$,
    'forbidden', '26/wglad organizatora: uczestnik bez roli admina odrzucony');
  PERFORM pg_temp.act_as();
END
$do$;

-- ---------------------------------------------------------------------------
-- (g) nabor prelegentow
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_t constant uuid := '11111111-1111-1111-1111-111111111111';
  v_person uuid;
BEGIN
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public._event_cfp_resolve_person(%L, '26a00000-0000-0000-0000-0000000000a3',
      '{"first_name":"Nela","last_name":"Niepotwierdzona","consent_data_processing":true}'::jsonb)$q$, v_t),
    'email_unverified', '26/nabor: konto bez potwierdzonego adresu -> email_unverified');

  v_person := public._event_cfp_resolve_person(v_t, '26a00000-0000-0000-0000-0000000000a4',
    '{"first_name":"Norbert","last_name":"Nabor","consent_data_processing":true,"consent_marketing":true,"lang":"pl","consent_text_version":1}'::jsonb);
  PERFORM pg_temp.assert(
    (SELECT user_id = '26a00000-0000-0000-0000-0000000000a4' AND consent_marketing_at IS NOT NULL
       FROM public.event_people WHERE id = v_person)
    AND EXISTS (SELECT 1 FROM public.event_consent_records
                 WHERE person_id = v_person AND evidence = 'verified_account' AND source = 'event_cfp'),
    '26/nabor: potwierdzony adres wiaze osobe, marketing przez ksiege (verified_account)');

  PERFORM public._event_cfp_resolve_person(v_t, '26a00000-0000-0000-0000-0000000000a5',
    '{"first_name":"Wanda","last_name":"Wycofana","consent_data_processing":true,"consent_marketing":true,"lang":"pl","consent_text_version":1}'::jsonb);
  PERFORM pg_temp.assert(
    (SELECT consent_marketing_at IS NULL AND consent_withdrawn_at = '2026-02-01 10:00+00'
       FROM public.event_people WHERE id = '26f00000-0000-0000-0000-000000000007'),
    '26/nabor: wycofanie lepkie (marketing nie wraca, consent_withdrawn_at nietkniety)');
END
$do$;

ROLLBACK;
