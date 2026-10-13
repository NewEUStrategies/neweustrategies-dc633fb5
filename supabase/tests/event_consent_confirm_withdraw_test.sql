-- pgTAP: potwierdzenie double opt-in, wycofanie zgod (klucz samoobslugi,
-- konto, link wypisu) i nabor prelegentow przez potwierdzony adres konta
-- (REG-02 / REG-14, jednostka B3) - migracje
-- 20261012133000_event_consent_confirm_withdraw,
-- 20261012133100_event_cfp_resolve_person_verified i
-- 20261012133200_email_unsubscribe_withdraws_event_consent.
--
-- DEFEKT. Rejestr zgod (A2) i rdzen zapisu (B1a) wydawaly niezweryfikowanemu
-- zapisujacemu link DOI, ale nic go nie potwierdzalo; zgody nie dalo sie
-- WYCOFAC zadnym kanalem (kazde przypisanie `consent_withdrawn_at` w
-- migracjach to `= NULL`), a `crm_leads.marketing_consent` tylko rosla.
-- Nabor prelegentow wiazal konto z kartoteka po NIEPOTWIERDZONYM adresie
-- konta i stawial zgode marketingowa kolumna, bez ksiegi.
--
-- KRYTERIUM AKCEPTACJI REG-14 (nazwa asercji, doslownie): „test odwolania,
-- ktore przechodzi do CRM".
--
-- CO PRZYPINA:
--   * ACL: podglad, potwierdzenie i wycofanie tylko service_role; stan zgod
--     uczestnika i wglad organizatora - authenticated;
--   * DOI: podglad bez zmian i bez danych osobowych; potwierdzenie projektuje
--     zgody, pisze ksiege (email_double_opt_in), podnosi zgode w CRM z
--     prawdziwym tekstem i wersja 'event-marketing-v1-pl'; drugi raz ->
--     already; obcy najemca -> not_found; po terminie i po zmianie adresu ->
--     expired (link zastapiony); kubelek liczony takze przy odmowie;
--   * wycofanie kluczem samoobslugi (takze wygaslym) i kontem: projekcja,
--     ksiega, CRM false + given=false, most nie wskrzesza; odpowiedz stala
--     dla osoby ze zgodami, bez zgod i dla nieznanego klucza; identyfikator
--     i adres z ladunku ignorowane;
--   * link wypisu z maila wycofuje marketing osoby wydarzen (ksiega
--     unsubscribe_link), partnerow nie rusza;
--   * nabor: konto bez potwierdzonego adresu -> email_unverified; potwierdzone
--     wiaze i udziela marketingu kanalem konta (raz); wycofanie lepkie;
--     brak wersji tekstu = brak zgody.
-- now() jest stale w transakcji - kolejnosc wpisow ksiegi niesie `seq`.
BEGIN;
SELECT plan(53);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Fikstury ────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b3c0a000-0000-0000-0000-0000000000aa', 'b3-a', 'Consent B3 A', 'b3-a.example'),
  ('b3c0b000-0000-0000-0000-0000000000bb', 'b3-b', 'Consent B3 B', 'b3-b.example');

-- a1 wlasciciel osoby P_O; a2 admin A; a3 konto bez potwierdzenia; a4/a5/a7
-- konta naboru (potwierdzone); a6 konto bez osoby.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b3c00000-0000-0000-0000-0000000000a1', 'owner@b3.example', now()),
  ('b3c00000-0000-0000-0000-0000000000a2', 'admin@b3.example', now()),
  ('b3c00000-0000-0000-0000-0000000000a3', 'cfp-unconf@b3.example', NULL),
  ('b3c00000-0000-0000-0000-0000000000a4', 'cfp@b3.example', now()),
  ('b3c00000-0000-0000-0000-0000000000a5', 'cfp-withdrawn@b3.example', now()),
  ('b3c00000-0000-0000-0000-0000000000a6', 'stranger@b3.example', now()),
  ('b3c00000-0000-0000-0000-0000000000a7', 'cfp-noversion@b3.example', now());
INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT u.id, u.email, 'B3 ' || u.email, 'b3c0a000-0000-0000-0000-0000000000aa'
  FROM auth.users u WHERE u.id::text LIKE 'b3c00000-%';
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('b3c00000-0000-0000-0000-0000000000a2', 'admin', 'b3c0a000-0000-0000-0000-0000000000aa');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('b3c10000-0000-0000-0000-0000000000e1', 'b3c0a000-0000-0000-0000-0000000000aa',
   'b3-e1', 'Forum B3', 'B3 Forum', now() + interval '30 days', 'published'),
  ('b3c10000-0000-0000-0000-0000000000e0', 'b3c0a000-0000-0000-0000-0000000000aa',
   'b3-past', 'Forum B3 minione', 'Past B3 Forum', now() - interval '10 days', 'published'),
  ('b3c10000-0000-0000-0000-0000000000e2', 'b3c0b000-0000-0000-0000-0000000000bb',
   'b3-e2', 'Forum B3 B', 'B3 Forum B', now() + interval '30 days', 'published');

-- V: ofiara/uczestnik bez zgod; P_O: dowiazana do a1 ze zgodami sprzed ksiegi;
-- P_N: bez zgod; P_X: zgloszenie na minione wydarzenie (klucz wygasl);
-- P_U: adres z newsletterem; P_E/P_C: linki DOI po terminie i po zmianie
-- adresu; P_W: wycofala zgody (nabor); P_B: najemca B.
INSERT INTO public.event_people
  (id, tenant_id, user_id, email, first_name, last_name, phone, consent_data_processing_at,
   consent_marketing_at, consent_partner_sharing_at, consent_withdrawn_at) VALUES
  ('b3c30000-0000-0000-0000-0000000000f1', 'b3c0a000-0000-0000-0000-0000000000aa', NULL,
   'victim@b3.example', 'Anna', 'Nowak', '+48 600 000 001', '2026-01-01 10:00+00', NULL, NULL, NULL),
  ('b3c30000-0000-0000-0000-0000000000f2', 'b3c0a000-0000-0000-0000-0000000000aa',
   'b3c00000-0000-0000-0000-0000000000a1', 'owner@b3.example', 'Ola', 'Owner', NULL,
   '2026-01-01 10:00+00', '2026-01-02 10:00+00', '2026-01-02 10:00+00', NULL),
  ('b3c30000-0000-0000-0000-0000000000f3', 'b3c0a000-0000-0000-0000-0000000000aa', NULL,
   'none@b3.example', 'Nikola', 'Nobody', NULL, '2026-01-01 10:00+00', NULL, NULL, NULL),
  ('b3c30000-0000-0000-0000-0000000000f4', 'b3c0a000-0000-0000-0000-0000000000aa', NULL,
   'expired@b3.example', 'Ewa', 'Expired', NULL, '2026-01-01 10:00+00', '2026-01-02 10:00+00', NULL, NULL),
  ('b3c30000-0000-0000-0000-0000000000f5', 'b3c0a000-0000-0000-0000-0000000000aa', NULL,
   'unsub@b3.example', 'Uma', 'Unsub', NULL, '2026-01-01 10:00+00', '2026-01-02 10:00+00',
   '2026-01-02 10:00+00', NULL),
  ('b3c30000-0000-0000-0000-0000000000f6', 'b3c0a000-0000-0000-0000-0000000000aa', NULL,
   'late@b3.example', 'Leon', 'Late', NULL, '2026-01-01 10:00+00', NULL, NULL, NULL),
  ('b3c30000-0000-0000-0000-0000000000f7', 'b3c0a000-0000-0000-0000-0000000000aa', NULL,
   'changed@b3.example', 'Cezary', 'Changed', NULL, '2026-01-01 10:00+00', NULL, NULL, NULL),
  ('b3c30000-0000-0000-0000-0000000000f8', 'b3c0a000-0000-0000-0000-0000000000aa', NULL,
   'cfp-withdrawn@b3.example', 'Wanda', 'Withdrawn', NULL, '2026-01-01 10:00+00', NULL, NULL,
   '2026-02-01 10:00+00'),
  ('b3c30000-0000-0000-0000-0000000000f9', 'b3c0b000-0000-0000-0000-0000000000bb', NULL,
   'tenant-b@b3.example', 'Bea', 'Other', NULL, '2026-01-01 10:00+00', NULL, NULL, NULL);

-- Klucze samoobslugi (32 znaki, ksztalt `_event_new_qr_token()`); w bazie sha256.
CREATE TEMP TABLE b3_tok (k text PRIMARY KEY, v text NOT NULL);
GRANT ALL ON b3_tok TO service_role, authenticated;
INSERT INTO b3_tok (k, v) VALUES
  ('owner',   'B3owner' || repeat('o', 25)),
  ('none',    'B3none' || repeat('n', 26)),
  ('expired', 'B3expired' || repeat('x', 23)),
  ('unknown', 'B3unknown' || repeat('u', 23)),
  ('foreign', 'B3foreign' || repeat('f', 23));

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, registration_mode, status, cancelled_at, manage_token_hash) VALUES
  ('b3c40000-0000-0000-0000-0000000000d2', 'b3c0a000-0000-0000-0000-0000000000aa',
   'b3c10000-0000-0000-0000-0000000000e1', 'b3c30000-0000-0000-0000-0000000000f2', 'rsvp', 'approved', NULL,
   encode(extensions.digest((SELECT v FROM b3_tok WHERE k = 'owner'), 'sha256'), 'hex')),
  ('b3c40000-0000-0000-0000-0000000000d3', 'b3c0a000-0000-0000-0000-0000000000aa',
   'b3c10000-0000-0000-0000-0000000000e1', 'b3c30000-0000-0000-0000-0000000000f3', 'rsvp', 'cancelled', now(),
   encode(extensions.digest((SELECT v FROM b3_tok WHERE k = 'none'), 'sha256'), 'hex')),
  ('b3c40000-0000-0000-0000-0000000000d4', 'b3c0a000-0000-0000-0000-0000000000aa',
   'b3c10000-0000-0000-0000-0000000000e0', 'b3c30000-0000-0000-0000-0000000000f4', 'rsvp', 'approved', NULL,
   encode(extensions.digest((SELECT v FROM b3_tok WHERE k = 'expired'), 'sha256'), 'hex')),
  ('b3c40000-0000-0000-0000-0000000000d9', 'b3c0b000-0000-0000-0000-0000000000bb',
   'b3c10000-0000-0000-0000-0000000000e2', 'b3c30000-0000-0000-0000-0000000000f9', 'rsvp', 'approved', NULL,
   encode(extensions.digest((SELECT v FROM b3_tok WHERE k = 'foreign'), 'sha256'), 'hex'));

INSERT INTO public.crm_leads (tenant_id, email, email_norm, marketing_consent) VALUES
  ('b3c0a000-0000-0000-0000-0000000000aa', 'victim@b3.example', 'victim@b3.example', false),
  ('b3c0a000-0000-0000-0000-0000000000aa', 'owner@b3.example', 'owner@b3.example', true)
-- Kontakt konta moze juz istniec (profil zaklada lead) - ustawiamy stan zgody wprost.
ON CONFLICT (tenant_id, email_norm) DO UPDATE SET marketing_consent = EXCLUDED.marketing_consent;

-- Subskrybent newslettera z adresem P_U (token wypisu per subskrybent).
INSERT INTO public.newsletter_subscribers (id, tenant_id, email, status, language, unsubscribe_token)
VALUES ('b3c60000-0000-0000-0000-0000000000a1', 'b3c0a000-0000-0000-0000-0000000000aa',
        'unsub@b3.example', 'subscribed', 'pl', 'tok-b3-unsub');

-- Linki DOI wydane funkcja rejestru: P_E (potem po terminie), P_C (potem
-- zmiana adresu), P_N (potem wycofanie kluczem - link zastapiony).
INSERT INTO b3_tok (k, v) VALUES
  ('doi_late', public._event_consent_issue_confirmation(
     'b3c0a000-0000-0000-0000-0000000000aa', 'b3c30000-0000-0000-0000-0000000000f6',
     ARRAY['marketing'], 'b3c10000-0000-0000-0000-0000000000e1', NULL, 1, 'pl', NULL, NULL)),
  ('doi_changed', public._event_consent_issue_confirmation(
     'b3c0a000-0000-0000-0000-0000000000aa', 'b3c30000-0000-0000-0000-0000000000f7',
     ARRAY['marketing'], 'b3c10000-0000-0000-0000-0000000000e1', NULL, 1, 'pl', NULL, NULL)),
  ('doi_none', public._event_consent_issue_confirmation(
     'b3c0a000-0000-0000-0000-0000000000aa', 'b3c30000-0000-0000-0000-0000000000f3',
     ARRAY['marketing'], 'b3c10000-0000-0000-0000-0000000000e1', NULL, 1, 'pl', NULL, NULL));
UPDATE public.event_consent_confirmations
   SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
 WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f6';
UPDATE public.event_people SET email = 'changed-new@b3.example'
 WHERE id = 'b3c30000-0000-0000-0000-0000000000f7';

-- Wynik kazdego wywolania pod nazwa (asercje czytaja go po RESET ROLE).
CREATE TEMP TABLE b3_r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON b3_r TO service_role, authenticated;

CREATE FUNCTION pg_temp.b3_confirm(p_tenant uuid, p_ip text, p_ua text, p_token text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.event_consent_confirm_for_request(p_tenant, NULL, p_ip, p_ua, p_token)
$$;
CREATE FUNCTION pg_temp.b3_withdraw(p_user uuid, p_ip text, p_payload jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.event_consent_withdraw_for_request(
    'b3c0a000-0000-0000-0000-0000000000aa', p_user, p_ip, 'pgtap-withdraw/1.0', p_payload)
$$;

-- ── 1-6. Uprawnienia ────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.event_consent_confirmation_preview(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_consent_confirmation_preview(uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_consent_confirmation_preview(uuid,text)', 'EXECUTE'),
  'podglad linku DOI: tylko service_role');
SELECT ok(
  NOT has_function_privilege('anon', 'public.event_consent_confirm_for_request(uuid,uuid,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_consent_confirm_for_request(uuid,uuid,text,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_consent_confirm_for_request(uuid,uuid,text,text,text)', 'EXECUTE'),
  'potwierdzenie linku DOI: tylko service_role');
SELECT ok(
  NOT has_function_privilege('anon', 'public.event_consent_withdraw_for_request(uuid,uuid,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_consent_withdraw_for_request(uuid,uuid,text,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_consent_withdraw_for_request(uuid,uuid,text,text,jsonb)', 'EXECUTE'),
  'wycofanie zgod: tylko service_role');
SELECT ok(
  NOT has_function_privilege('anon', 'public.event_my_consent_state()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_my_consent_state()', 'EXECUTE'),
  'stan zgod uczestnika: authenticated, bez anon');
SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_event_registration_consent_detail(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_registration_consent_detail(uuid)', 'EXECUTE'),
  'wglad organizatora: authenticated (bramka admina w ciele), bez anon');
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_consent_confirmation_state(public.event_consent_confirmations)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_consent_confirmation_state(public.event_consent_confirmations)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_cfp_resolve_person(uuid,uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_cfp_resolve_person(uuid,uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.email_unsubscribe_by_token(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.email_unsubscribe_by_token(text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.email_unsubscribe_by_token(text)', 'EXECUTE'),
  'funkcje wewnetrzne i wypis z maila: bez EXECUTE dla klienta, wypis dla service_role');

-- ── Zapis niezweryfikowany: link DOI do skrzynki (sciezka produkcyjna B1a) ──
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO b3_r (k, v) VALUES
  ('reg', public.event_register_for_client(
     'b3c0a000-0000-0000-0000-0000000000aa', NULL, 'ip:' || repeat('b1', 16), 'pgtap/1.0',
     jsonb_build_object('event_slug', 'b3-e1', 'email', 'victim@b3.example',
       'first_name', 'Anna', 'last_name', 'Attacker', 'phone', '+48 999 999 999',
       'consent_data_processing', true, 'consent_marketing', true,
       'consent_partner_sharing', true, 'lang', 'pl', 'consent_text_version', 1)));
INSERT INTO b3_tok (k, v)
SELECT 'doi', r.v->'delivery'->'consent_confirmation'->>'token' FROM b3_r r WHERE r.k = 'reg';
INSERT INTO b3_tok (k, v)
SELECT 'victim', r.v->'delivery'->>'manage_token' FROM b3_r r WHERE r.k = 'reg';
RESET ROLE;

-- ── 7. Warunek wstepny ──────────────────────────────────────────────────────
SELECT ok(
  char_length((SELECT v FROM b3_tok WHERE k = 'doi')) = 32
  AND (SELECT consent_marketing_at IS NULL AND consent_partner_sharing_at IS NULL
         FROM public.event_people WHERE id = 'b3c30000-0000-0000-0000-0000000000f1')
  AND (SELECT count(*) FROM public.event_consent_records
        WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f1' AND status = 'pending') = 2,
  'zapis niezweryfikowany: link DOI (32 znaki), zgody tylko pending, projekcja pusta');

-- ── 8-11. Podglad (GET) ─────────────────────────────────────────────────────
SET LOCAL ROLE service_role;
INSERT INTO b3_r (k, v) VALUES
  ('preview', public.event_consent_confirmation_preview(
     'b3c0a000-0000-0000-0000-0000000000aa', (SELECT v FROM b3_tok WHERE k = 'doi'))),
  ('preview_b', public.event_consent_confirmation_preview(
     'b3c0b000-0000-0000-0000-0000000000bb', (SELECT v FROM b3_tok WHERE k = 'doi'))),
  ('preview_bad', public.event_consent_confirmation_preview(
     'b3c0a000-0000-0000-0000-0000000000aa', 'nie-token'));
RESET ROLE;

SELECT ok(
  (SELECT v->>'state' = 'open'
          AND v->'purposes' = '["marketing", "partner_sharing"]'::jsonb
          AND v->'event'->>'slug' = 'b3-e1'
          AND (v->'texts'->0->>'body') = (SELECT body FROM public.event_consent_texts
                                            WHERE purpose = 'marketing' AND version = 1 AND lang = 'pl')
     FROM b3_r WHERE k = 'preview'),
  'podglad: stan open, cele, wydarzenie i dokladny tekst zgody z wersji linku');
SELECT ok(
  (SELECT v::text !~* '(victim|anna|nowak|attacker|\+48)' FROM b3_r WHERE k = 'preview'),
  'podglad bez danych osobowych (adres, imie, nazwisko, telefon)');
SELECT ok(
  (SELECT confirmed_at IS NULL FROM public.event_consent_confirmations
    WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f1')
  AND (SELECT consent_marketing_at IS NULL FROM public.event_people
        WHERE id = 'b3c30000-0000-0000-0000-0000000000f1'),
  'podglad (GET) niczego nie zmienia - skaner poczty nie potwierdzi zgody');
SELECT ok(
  (SELECT v->>'state' FROM b3_r WHERE k = 'preview_b') = 'not_found'
  AND (SELECT v->>'state' FROM b3_r WHERE k = 'preview_bad') = 'not_found',
  'podglad: obcy najemca i zly ksztalt tokenu -> not_found');

-- ── 12-21. Potwierdzenie (POST) ─────────────────────────────────────────────
SET LOCAL ROLE service_role;
INSERT INTO b3_r (k, v) VALUES
  ('confirm_b', pg_temp.b3_confirm('b3c0b000-0000-0000-0000-0000000000bb', 'ip:' || repeat('b2', 16),
     'pgtap-confirm/1.0', (SELECT v FROM b3_tok WHERE k = 'doi')));
INSERT INTO b3_r (k, v) VALUES
  ('confirm', pg_temp.b3_confirm('b3c0a000-0000-0000-0000-0000000000aa', 'ip:' || repeat('b2', 16),
     'pgtap-confirm/1.0', (SELECT v FROM b3_tok WHERE k = 'doi')));
INSERT INTO b3_r (k, v) VALUES
  ('confirm_again', pg_temp.b3_confirm('b3c0a000-0000-0000-0000-0000000000aa', 'ip:' || repeat('b2', 16),
     'pgtap-confirm/1.0', (SELECT v FROM b3_tok WHERE k = 'doi'))),
  ('preview_after', public.event_consent_confirmation_preview(
     'b3c0a000-0000-0000-0000-0000000000aa', (SELECT v FROM b3_tok WHERE k = 'doi')));
RESET ROLE;

SELECT is((SELECT v->>'state' FROM b3_r WHERE k = 'confirm_b'), 'not_found',
  'potwierdzenie z obcego najemcy -> not_found (link najemcy A nietkniety)');
SELECT is((SELECT v FROM b3_r WHERE k = 'confirm'),
  '{"ok": true, "state": "confirmed", "purposes": ["marketing", "partner_sharing"]}'::jsonb,
  'potwierdzenie linku: ok, confirmed, oba cele');
SELECT ok(
  (SELECT consent_marketing_at IS NOT NULL AND consent_partner_sharing_at IS NOT NULL
          AND consent_withdrawn_at IS NULL
     FROM public.event_people WHERE id = 'b3c30000-0000-0000-0000-0000000000f1'),
  'DOI projektuje zgody marketingu i partnerow w kartotece');
SELECT is(
  (SELECT count(*)::int FROM public.event_consent_records r
     JOIN public.event_consent_confirmations c ON c.id = r.confirmation_id
    WHERE r.person_id = 'b3c30000-0000-0000-0000-0000000000f1'
      AND r.status = 'confirmed' AND r.evidence = 'email_double_opt_in'
      AND r.ip_subject = 'ip:' || repeat('b2', 16) AND r.user_agent = 'pgtap-confirm/1.0'
      AND r.text_version = 1 AND r.text_lang = 'pl'),
  2, 'ksiega: dwa wpisy confirmed/email_double_opt_in z linkiem, skrotem IP i user agentem potwierdzenia');
SELECT ok(
  (SELECT confirmed_at IS NOT NULL AND confirmed_ip_subject = 'ip:' || repeat('b2', 16)
          AND confirmed_user_agent = 'pgtap-confirm/1.0' AND superseded_at IS NULL
     FROM public.event_consent_confirmations
    WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f1'),
  'link ostemplowany: confirmed_at, skrot IP i user agent potwierdzenia');
SELECT is(
  (SELECT marketing_consent FROM public.crm_leads
    WHERE tenant_id = 'b3c0a000-0000-0000-0000-0000000000aa' AND email_norm = 'victim@b3.example'),
  true, 'DOI marketingu podnosi zgode kontaktu CRM (marketing_consent = true)');
SELECT ok(
  (SELECT count(*) = 1
          AND bool_and(g.consent_text = (SELECT body FROM public.event_consent_texts
                                           WHERE purpose = 'marketing' AND version = 1 AND lang = 'pl'))
          AND bool_and(g.consent_version = 'event-marketing-v1-pl')
          AND bool_and(g.form_name = 'evidence:email_double_opt_in')
          AND bool_and(g.ip = 'ip:' || repeat('b2', 16) AND g.user_agent = 'pgtap-confirm/1.0')
     FROM public.crm_consent_log g
    WHERE g.tenant_id = 'b3c0a000-0000-0000-0000-0000000000aa'
      AND lower(g.email) = 'victim@b3.example' AND g.consent_key = 'marketing' AND g.given),
  'rejestr zgod CRM: given=true z prawdziwym tekstem, wersja event-marketing-v1-pl, kanalem, IP i UA');
SELECT is((SELECT v->>'state' FROM b3_r WHERE k = 'confirm_again'), 'already',
  'drugie potwierdzenie tego samego linku -> already');
SELECT is((SELECT v->>'state' FROM b3_r WHERE k = 'preview_after'), 'already',
  'podglad po potwierdzeniu -> already');
SELECT ok(
  (SELECT count = 2 FROM public.rate_limits
    WHERE scope = 'event_consent_confirm'
      AND subject_id = 'b3c0a000-0000-0000-0000-0000000000aa:ip:' || repeat('b2', 16))
  AND (SELECT count = 1 FROM public.rate_limits
        WHERE scope = 'event_consent_confirm'
          AND subject_id = 'b3c0b000-0000-0000-0000-0000000000bb:ip:' || repeat('b2', 16)),
  'kubelek event_consent_confirm liczony per najemca i skrot adresu (takze odmowa obcego najemcy)');

-- ── 22-26. Link po terminie, po zmianie adresu, limit prob ──────────────────
INSERT INTO public.rate_limits (scope, subject_id, window_start, count) VALUES
  ('event_consent_confirm', 'b3c0a000-0000-0000-0000-0000000000aa:ip:' || repeat('b9', 16),
   to_timestamp(floor(extract(epoch FROM now()) / 600) * 600), 30);
SET LOCAL ROLE service_role;
INSERT INTO b3_r (k, v) VALUES
  ('late', pg_temp.b3_confirm('b3c0a000-0000-0000-0000-0000000000aa', 'ip:' || repeat('b3', 16),
     'ua', (SELECT v FROM b3_tok WHERE k = 'doi_late'))),
  ('changed_preview', public.event_consent_confirmation_preview(
     'b3c0a000-0000-0000-0000-0000000000aa', (SELECT v FROM b3_tok WHERE k = 'doi_changed'))),
  ('changed', pg_temp.b3_confirm('b3c0a000-0000-0000-0000-0000000000aa', 'ip:' || repeat('b3', 16),
     'ua', (SELECT v FROM b3_tok WHERE k = 'doi_changed'))),
  ('limited', pg_temp.b3_confirm('b3c0a000-0000-0000-0000-0000000000aa', 'ip:' || repeat('b9', 16),
     'ua', (SELECT v FROM b3_tok WHERE k = 'doi_none')));
RESET ROLE;

SELECT ok(
  (SELECT v->>'state' FROM b3_r WHERE k = 'late') = 'expired'
  AND (SELECT superseded_at IS NOT NULL AND confirmed_at IS NULL FROM public.event_consent_confirmations
        WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f6')
  AND (SELECT consent_marketing_at IS NULL FROM public.event_people
        WHERE id = 'b3c30000-0000-0000-0000-0000000000f6'),
  'link po terminie -> expired, oznaczony jako zastapiony, bez zgody');
SELECT is((SELECT v->>'state' FROM b3_r WHERE k = 'changed_preview'), 'expired',
  'podglad linku wydanego na stary adres osoby -> expired');
SELECT ok(
  (SELECT v->>'state' FROM b3_r WHERE k = 'changed') = 'expired'
  AND (SELECT superseded_at IS NOT NULL FROM public.event_consent_confirmations
        WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f7')
  AND (SELECT consent_marketing_at IS NULL FROM public.event_people
        WHERE id = 'b3c30000-0000-0000-0000-0000000000f7')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f7' AND status = 'confirmed'),
  'adres osoby zmieniony po wydaniu linku -> expired + superseded, zadnej zgody dla nowej skrzynki');
SELECT is((SELECT v FROM b3_r WHERE k = 'limited'), '{"ok": false, "state": "rate_limited"}'::jsonb,
  'pelny kubelek adresu -> rate_limited wartoscia');
SELECT ok(
  (SELECT count = 31 FROM public.rate_limits
    WHERE scope = 'event_consent_confirm'
      AND subject_id = 'b3c0a000-0000-0000-0000-0000000000aa:ip:' || repeat('b9', 16))
  AND (SELECT confirmed_at IS NULL FROM public.event_consent_confirmations
        WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f3'),
  'odmowa limitu nie cofa licznika i nie potwierdza linku');

-- ── 27-34. REG-14: wycofanie kluczem samoobslugi -> CRM ─────────────────────
SET LOCAL ROLE service_role;
INSERT INTO b3_r (k, v) VALUES
  ('w_victim', pg_temp.b3_withdraw(NULL, 'ip:' || repeat('c1', 16),
     jsonb_build_object('manage_token', (SELECT v FROM b3_tok WHERE k = 'victim'), 'purposes', 'all')));
RESET ROLE;
SELECT public._event_person_crm_sync(
  'b3c0a000-0000-0000-0000-0000000000aa', 'b3c30000-0000-0000-0000-0000000000f1',
  'event_participant', 'event:b3-e1:checkin', ARRAY['event:b3-e1'], '{}'::jsonb, true,
  'event.checkin.attended', '{}'::jsonb);

SELECT is((SELECT v FROM b3_r WHERE k = 'w_victim'), '{"ok": true}'::jsonb,
  'wycofanie kluczem: odpowiedz stala {ok:true}');
SELECT ok(
  (SELECT consent_marketing_at IS NULL AND consent_partner_sharing_at IS NULL
          AND consent_withdrawn_at IS NOT NULL
     FROM public.event_people WHERE id = 'b3c30000-0000-0000-0000-0000000000f1'),
  'wycofanie wszystkiego: projekcja marketingu i partnerow pusta, consent_withdrawn_at ustawione');
SELECT is(
  (SELECT count(*)::int FROM public.event_consent_records
    WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f1'
      AND status = 'withdrawn' AND evidence = 'manage_token'
      AND ip_subject = 'ip:' || repeat('c1', 16) AND user_agent = 'pgtap-withdraw/1.0'),
  2, 'ksiega: dwa wpisy withdrawn z dowodem manage_token, skrotem IP i user agentem serwera');
SELECT ok(
  (SELECT NOT marketing_consent FROM public.crm_leads
    WHERE tenant_id = 'b3c0a000-0000-0000-0000-0000000000aa' AND email_norm = 'victim@b3.example')
  AND EXISTS (
    SELECT 1 FROM public.crm_consent_log g
     WHERE g.tenant_id = 'b3c0a000-0000-0000-0000-0000000000aa'
       AND lower(g.email) = 'victim@b3.example' AND g.consent_key = 'marketing'
       AND NOT g.given AND g.source_type = 'event' AND g.form_id = 'event_consent:manage_token'),
  'REG-14: test odwolania, ktore przechodzi do CRM - marketing_consent = false i wiersz given=false');
SELECT ok(
  (SELECT NOT marketing_consent FROM public.crm_leads
    WHERE tenant_id = 'b3c0a000-0000-0000-0000-0000000000aa' AND email_norm = 'victim@b3.example')
  AND (SELECT count(*) = 1 FROM public.crm_consent_log g
        WHERE g.tenant_id = 'b3c0a000-0000-0000-0000-0000000000aa'
          AND lower(g.email) = 'victim@b3.example' AND g.consent_key = 'marketing' AND g.given),
  'pozniejsze wywolanie mostu CRM (odprawa) nie wskrzesza zgody ani nie dopisuje given=true');

SET LOCAL ROLE service_role;
INSERT INTO b3_r (k, v) VALUES
  ('w_none', pg_temp.b3_withdraw(NULL, 'ip:' || repeat('c2', 16),
     jsonb_build_object('manage_token', (SELECT v FROM b3_tok WHERE k = 'none'), 'purposes', 'all'))),
  ('w_unknown', pg_temp.b3_withdraw(NULL, 'ip:' || repeat('c2', 16),
     jsonb_build_object('manage_token', (SELECT v FROM b3_tok WHERE k = 'unknown'), 'purposes', 'all'))),
  ('w_foreign', pg_temp.b3_withdraw(NULL, 'ip:' || repeat('c2', 16),
     jsonb_build_object('manage_token', (SELECT v FROM b3_tok WHERE k = 'foreign'), 'purposes', 'all'))),
  -- Identyfikator i adres P_O w ladunku, bez klucza i bez sesji.
  ('w_payload_ids', pg_temp.b3_withdraw(NULL, 'ip:' || repeat('c2', 16),
     jsonb_build_object('purposes', 'all', 'person_id', 'b3c30000-0000-0000-0000-0000000000f2',
                        'email', 'owner@b3.example', 'user_id', 'b3c00000-0000-0000-0000-0000000000a1')));
INSERT INTO b3_r (k, v) VALUES
  ('confirm_none_after_withdraw', pg_temp.b3_confirm('b3c0a000-0000-0000-0000-0000000000aa',
     'ip:' || repeat('c3', 16), 'ua', (SELECT v FROM b3_tok WHERE k = 'doi_none')));
RESET ROLE;

SELECT ok(
  (SELECT count(DISTINCT v) = 1 AND bool_and(v = '{"ok": true}'::jsonb)
     FROM b3_r WHERE k IN ('w_victim', 'w_none', 'w_unknown', 'w_foreign', 'w_payload_ids')),
  'odpowiedz wycofania identyczna: osoba ze zgodami, bez zgod, nieznany klucz, klucz obcego najemcy, same identyfikatory');
SELECT ok(
  (SELECT consent_marketing_at IS NOT NULL AND consent_partner_sharing_at IS NOT NULL
     FROM public.event_people WHERE id = 'b3c30000-0000-0000-0000-0000000000f2')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f2' AND status = 'withdrawn')
  AND (SELECT consent_marketing_at IS NULL FROM public.event_people
        WHERE id = 'b3c30000-0000-0000-0000-0000000000f9')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f9'),
  'identyfikator osoby, adres i konto z ladunku ignorowane; klucz obcego najemcy niczego nie wycofuje');
SELECT ok(
  (SELECT v->>'state' FROM b3_r WHERE k = 'confirm_none_after_withdraw') = 'expired'
  AND EXISTS (SELECT 1 FROM public.event_consent_records
               WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f3'
                 AND status = 'withdrawn' AND evidence = 'manage_token')
  AND (SELECT consent_marketing_at IS NULL FROM public.event_people
        WHERE id = 'b3c30000-0000-0000-0000-0000000000f3'),
  'klucz anulowanego zgloszenia wycofuje, a otwarty link DOI przestaje dzialac (expired)');

-- ── 35-39. Klucz wygasly, konto, cele ───────────────────────────────────────
SET LOCAL ROLE service_role;
INSERT INTO b3_r (k, v) VALUES
  ('w_expired', pg_temp.b3_withdraw(NULL, 'ip:' || repeat('c4', 16),
     jsonb_build_object('manage_token', (SELECT v FROM b3_tok WHERE k = 'expired'),
                        'purposes', jsonb_build_array('marketing')))),
  ('w_account', pg_temp.b3_withdraw('b3c00000-0000-0000-0000-0000000000a1', 'ip:' || repeat('c5', 16),
     jsonb_build_object('purposes', jsonb_build_array('marketing')))),
  ('w_stranger', pg_temp.b3_withdraw('b3c00000-0000-0000-0000-0000000000a6', 'ip:' || repeat('c5', 16),
     jsonb_build_object('purposes', 'all'))),
  ('w_invalid', pg_temp.b3_withdraw(NULL, 'ip:' || repeat('c5', 16),
     jsonb_build_object('manage_token', (SELECT v FROM b3_tok WHERE k = 'owner'),
                        'purposes', 'data_processing')));
RESET ROLE;

SELECT ok(
  (SELECT v FROM b3_r WHERE k = 'w_expired') = '{"ok": true}'::jsonb
  AND (SELECT consent_marketing_at IS NULL FROM public.event_people
        WHERE id = 'b3c30000-0000-0000-0000-0000000000f4')
  AND EXISTS (SELECT 1 FROM public.event_consent_records
               WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f4'
                 AND status = 'withdrawn' AND evidence = 'manage_token' AND purpose = 'marketing'),
  'klucz wygasly (wydarzenie minelo) nadal wycofuje zgode - art. 7 ust. 3 RODO');
SELECT ok(
  (SELECT consent_marketing_at IS NULL AND consent_partner_sharing_at IS NOT NULL
          AND consent_withdrawn_at IS NULL
     FROM public.event_people WHERE id = 'b3c30000-0000-0000-0000-0000000000f2')
  AND EXISTS (SELECT 1 FROM public.event_consent_records
               WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f2'
                 AND status = 'withdrawn' AND evidence = 'account_settings' AND purpose = 'marketing'
                 AND actor_user_id = 'b3c00000-0000-0000-0000-0000000000a1'),
  'wycofanie z konta: osoba dowiazana do sesji, tylko marketing, dowod account_settings');
SELECT is(
  (SELECT marketing_consent FROM public.crm_leads
    WHERE tenant_id = 'b3c0a000-0000-0000-0000-0000000000aa' AND email_norm = 'owner@b3.example'),
  false, 'wycofanie z konta dociera do CRM');
SELECT ok(
  (SELECT v FROM b3_r WHERE k = 'w_stranger') = '{"ok": true}'::jsonb
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE actor_user_id = 'b3c00000-0000-0000-0000-0000000000a6'),
  'konto bez osoby: odpowiedz stala, nic nie zapisane');
SELECT is((SELECT v FROM b3_r WHERE k = 'w_invalid'), '{"ok": false, "error": "invalid_payload"}'::jsonb,
  'cel spoza marketing/partner_sharing/all -> invalid_payload (zgody na przetwarzanie tu sie nie wycofuje)');

-- ── 40-41. Link wypisu z maila ──────────────────────────────────────────────
SET LOCAL ROLE service_role;
INSERT INTO b3_r (k, v) VALUES ('unsub', public.email_unsubscribe_by_token('tok-b3-unsub'));
RESET ROLE;

SELECT ok(
  (SELECT (v->>'ok')::boolean FROM b3_r WHERE k = 'unsub')
  AND (SELECT consent_marketing_at IS NULL FROM public.event_people
        WHERE id = 'b3c30000-0000-0000-0000-0000000000f5')
  AND EXISTS (SELECT 1 FROM public.event_consent_records
               WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f5'
                 AND status = 'withdrawn' AND evidence = 'unsubscribe_link' AND purpose = 'marketing')
  AND EXISTS (SELECT 1 FROM public.crm_consent_log g
               WHERE g.tenant_id = 'b3c0a000-0000-0000-0000-0000000000aa'
                 AND lower(g.email) = 'unsub@b3.example' AND NOT g.given
                 AND g.form_id = 'event_consent:unsubscribe_link'),
  'link wypisu z maila wycofuje marketing osoby wydarzen: projekcja, ksiega unsubscribe_link, CRM given=false');
SELECT ok(
  (SELECT consent_partner_sharing_at IS NOT NULL AND consent_withdrawn_at IS NULL
     FROM public.event_people WHERE id = 'b3c30000-0000-0000-0000-0000000000f5'),
  'wypis z maila nie rusza zgody na udostepnianie partnerom');

-- ── 42-43. Stan zgod zalogowanego uczestnika ────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b3c00000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'b3c00000-0000-0000-0000-0000000000a1', true);
SET LOCAL ROLE authenticated;
INSERT INTO b3_r (k, v) VALUES ('my_owner', public.event_my_consent_state());
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"b3c00000-0000-0000-0000-0000000000a6","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'b3c00000-0000-0000-0000-0000000000a6', true);
SET LOCAL ROLE authenticated;
INSERT INTO b3_r (k, v) VALUES ('my_stranger', public.event_my_consent_state());
RESET ROLE;

SELECT ok(
  (SELECT (v->>'linked')::boolean
          AND v->>'email' = 'owner@b3.example'
          AND v->'consents'->>'marketing_at' IS NULL
          AND v->'consents'->>'partner_sharing_at' IS NOT NULL
          AND v->'ledger'->0->>'status' = 'withdrawn'
          AND v->'ledger'->0->>'evidence' = 'account_settings'
          AND v::text !~ 'ip_subject|user_agent|ip:'
     FROM b3_r WHERE k = 'my_owner'),
  'stan zgod uczestnika: osoba konta, projekcja i ksiega (najnowszy wpis pierwszy), bez skrotu IP i UA');
SELECT is((SELECT v FROM b3_r WHERE k = 'my_stranger'),
  '{"email": null, "ledger": [], "linked": false, "consents": null, "open_confirmation": null}'::jsonb,
  'konto bez osoby wydarzen: linked=false, pusta ksiega');

-- ── 44-46. Wglad organizatora ───────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b3c00000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'b3c00000-0000-0000-0000-0000000000a2', true);
SET LOCAL ROLE authenticated;
INSERT INTO b3_r (k, v)
SELECT 'admin_detail', public.admin_event_registration_consent_detail((r.v->'delivery'->>'registration_id')::uuid)
  FROM b3_r r WHERE r.k = 'reg';
SELECT throws_like(
  $$SELECT public.admin_event_registration_consent_detail('b3c40000-0000-0000-0000-0000000000d9')$$,
  'not_found%', 'organizator nie widzi zgloszenia obcego najemcy (not_found)');
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"b3c00000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'b3c00000-0000-0000-0000-0000000000a1', true);
SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$SELECT public.admin_event_registration_consent_detail('b3c40000-0000-0000-0000-0000000000d2')$$,
  'forbidden%', 'uczestnik bez roli admina nie widzi szczegolu zgod (forbidden)');
RESET ROLE;

SELECT ok(
  (SELECT (v->>'differs')::boolean
          AND v->'differences' @> '["last_name", "phone"]'::jsonb
          AND NOT (v->'differences' ? 'first_name')
          AND v->'submitted_profile'->>'last_name' = 'Attacker'
          AND v->'current'->>'last_name' = 'Nowak'
          AND jsonb_array_length(v->'ledger') >= 7
          AND v->'open_confirmation' = 'null'::jsonb
     FROM b3_r WHERE k = 'admin_detail'),
  'organizator widzi dane z zapisu obok kartoteki (roznice: nazwisko, telefon) i ksiege zgod osoby');

-- ── 47-53. Nabor prelegentow ────────────────────────────────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT throws_like(
  $$SELECT public._event_cfp_resolve_person('b3c0a000-0000-0000-0000-0000000000aa',
      'b3c00000-0000-0000-0000-0000000000a3',
      '{"first_name":"Ula","last_name":"Unconf","consent_data_processing":true,"consent_marketing":true,"lang":"pl","consent_text_version":1}'::jsonb)$$,
  'email_unverified%', 'nabor: konto bez potwierdzonego adresu -> email_unverified');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_people
               WHERE user_id = 'b3c00000-0000-0000-0000-0000000000a3'
                  OR email_norm = 'cfp-unconf@b3.example'),
  'nabor: konto bez potwierdzenia nie dostaje ani nie zaklada kartoteki');

INSERT INTO b3_tok (k, v)
SELECT 'cfp_person', public._event_cfp_resolve_person('b3c0a000-0000-0000-0000-0000000000aa',
  'b3c00000-0000-0000-0000-0000000000a4',
  '{"first_name":"Cyprian","last_name":"Cfp","consent_data_processing":true,"consent_marketing":true,"lang":"pl","consent_text_version":1}'::jsonb)::text;
SELECT public._event_cfp_resolve_person('b3c0a000-0000-0000-0000-0000000000aa',
  'b3c00000-0000-0000-0000-0000000000a4',
  '{"first_name":"Cyprian","last_name":"Cfp","consent_data_processing":true,"consent_marketing":true,"lang":"pl","consent_text_version":1}'::jsonb);

SELECT ok(
  (SELECT user_id = 'b3c00000-0000-0000-0000-0000000000a4' AND email_norm = 'cfp@b3.example'
          AND consent_marketing_at IS NOT NULL AND consent_withdrawn_at IS NULL
     FROM public.event_people WHERE id = (SELECT v::uuid FROM b3_tok WHERE k = 'cfp_person')),
  'nabor: potwierdzony adres konta wiaze osobe i udziela marketingu');
SELECT ok(
  (SELECT count(*) = 1
          AND bool_and(status = 'confirmed' AND evidence = 'verified_account' AND source = 'event_cfp'
                       AND text_version = 1 AND text_lang = 'pl'
                       AND actor_user_id = 'b3c00000-0000-0000-0000-0000000000a4')
     FROM public.event_consent_records
    WHERE person_id = (SELECT v::uuid FROM b3_tok WHERE k = 'cfp_person') AND purpose = 'marketing'),
  'nabor: marketing przez ksiege (verified_account, tekst v1/pl) - jeden wpis mimo dwoch zapisow');

SELECT public._event_cfp_resolve_person('b3c0a000-0000-0000-0000-0000000000aa',
  'b3c00000-0000-0000-0000-0000000000a5',
  '{"first_name":"Wanda","last_name":"Withdrawn","consent_data_processing":true,"consent_marketing":true,"lang":"pl","consent_text_version":1}'::jsonb);
SELECT ok(
  (SELECT user_id = 'b3c00000-0000-0000-0000-0000000000a5' AND consent_marketing_at IS NULL
          AND consent_withdrawn_at = '2026-02-01 10:00+00'
     FROM public.event_people WHERE id = 'b3c30000-0000-0000-0000-0000000000f8')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE person_id = 'b3c30000-0000-0000-0000-0000000000f8' AND status = 'confirmed'),
  'nabor: wycofanie lepkie - zaznaczenie marketingu nie przywraca zgody ani nie zeruje consent_withdrawn_at');

SELECT public._event_cfp_resolve_person('b3c0a000-0000-0000-0000-0000000000aa',
  'b3c00000-0000-0000-0000-0000000000a7',
  '{"first_name":"Norbert","last_name":"Noversion","consent_data_processing":true,"consent_marketing":true}'::jsonb);
SELECT ok(
  (SELECT user_id = 'b3c00000-0000-0000-0000-0000000000a7' AND consent_marketing_at IS NULL
     FROM public.event_people WHERE email_norm = 'cfp-noversion@b3.example')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records r
                    JOIN public.event_people p ON p.id = r.person_id
                   WHERE p.email_norm = 'cfp-noversion@b3.example' AND r.purpose = 'marketing'),
  'nabor: bez wersji i jezyka tekstu (stara paczka) zgoda marketingowa nie jest zapisywana');
SELECT is(
  (SELECT count(*)::int FROM public.event_people
    WHERE tenant_id = 'b3c0a000-0000-0000-0000-0000000000aa'
      AND user_id IN ('b3c00000-0000-0000-0000-0000000000a4', 'b3c00000-0000-0000-0000-0000000000a5',
                      'b3c00000-0000-0000-0000-0000000000a7')
      AND NOT public._event_uid_owns_email(user_id, email_norm)),
  0, 'nabor: kazde dowiazanie konta ma potwierdzony adres osoby (D1)');

SELECT * FROM finish();
ROLLBACK;
