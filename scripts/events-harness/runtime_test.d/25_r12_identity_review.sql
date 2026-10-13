-- ============================================================================
-- 25_r12_identity_review - POPRAWKI PRZEGLADU R12 NA REPLAYU MODULU WYDARZEN
-- (20261012180500..180700; REG-01, REG-02)
--
-- PO CO TEN PLIK ISTNIEJE
-- pgTAP (event_identity_consents_r12_test.sql) przypina te tezy na pelnym
-- schemacie; tu sprawdzamy je na tych samych cialach, ktore dostaja pozostale
-- pliki harnessu, i na atrapie `auth.users` (`email_confirmed_at` DEFAULT
-- now(), `raw_app_meta_data` DEFAULT '{}').
--
-- CO SPRAWDZA
--   1. Konto zalozone przez administratora (`app_metadata.provisioned_by_admin`)
--      nie jest wlascicielem adresu: zapis bez dowiazania i bez nadpisania.
--   2. Konto DOWIAZANE do osoby, ale bez potwierdzonego jej adresu - sciezka
--      obcego (kartoteka nietknieta, `submitted_profile`, zgody `pending`).
--   3. Zmiana adresu osoby przez organizatora odwiazuje konto (wpis
--      `admin_unbind`); wlasciciel nowego adresu dostaje kartoteke.
--   4. Lista przegladu: przejecie z podmiana adresu (mail zgloszenia na inny
--      adres) jako `suspect_takeover`, nie w audycie; ekran organizatora ma
--      klucz `suspect`.
--
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================
\echo '== 25 R12: wlasciciel = potwierdzony adres, konta administratora, przeglad przejec =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2', 'Tenant C5C2 (R12)', 'tc5c2-r12');

-- 01 Z (dowiazany do cudzego adresu), 02 Y (wlasciciel y@), 03 admin,
-- 04 T (przejecie z podmiana), 05 P (konto zalozone przez administratora).
INSERT INTO auth.users (id, email) VALUES
  ('c5c00000-0000-0000-0000-000000000001', 'z.r12@example.org'),
  ('c5c00000-0000-0000-0000-000000000002', 'y.r12@example.org'),
  ('c5c00000-0000-0000-0000-000000000003', 'admin.r12@example.org'),
  ('c5c00000-0000-0000-0000-000000000004', 'attacker.r12@example.org');
INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('c5c00000-0000-0000-0000-000000000005', 'prov.r12@example.org',
   '{"provisioned_by_admin":true,"provisioned_email":"prov.r12@example.org"}');
INSERT INTO public.profiles (id, tenant_id, display_name) VALUES
  ('c5c00000-0000-0000-0000-000000000003', 'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2', 'Admin R12');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c5c00000-0000-0000-0000-000000000003', 'admin', 'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
  registration_mode, registration_flow) VALUES
  ('c5c10000-0000-0000-0000-000000000001', 'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2', 'r12-glowne',
   'Glowne', 'Main', now() + interval '30 days', NULL, 'published', 'rsvp', 'instant'),
  ('c5c10000-0000-0000-0000-000000000002', 'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2', 'r12-drugie',
   'Drugie', 'Second', now() + interval '30 days', NULL, 'published', 'rsvp', 'instant'),
  ('c5c10000-0000-0000-0000-000000000003', 'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2', 'r12-trzecie',
   'Trzecie', 'Third', now() + interval '30 days', NULL, 'published', 'rsvp', 'instant');

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, phone, created_by) VALUES
  -- Z dowiazany do osoby z adresem kolega@ (dryf dowiazania).
  ('c5c50000-0000-0000-0000-000000000001', 'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2',
   'c5c00000-0000-0000-0000-000000000001', 'kolega.r12@example.org', 'Zofia', 'Zet', '+48 500 100 100',
   'c5c00000-0000-0000-0000-000000000001'),
  -- Osoba Z2 (bez konta pozniej) - organizator zmieni adres na y@.
  ('c5c50000-0000-0000-0000-000000000002', 'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2',
   'c5c00000-0000-0000-0000-000000000004', 'attacker.r12@example.org', 'Vera', 'Victim', NULL, NULL),
  -- Osoba w kartotece o adresie konta zalozonego przez administratora.
  ('c5c50000-0000-0000-0000-000000000003', 'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2',
   NULL, 'prov.r12@example.org', 'Prawdziwa', 'Osoba', '+48 500 000 000', NULL);
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status, registration_mode,
  source, created_by) VALUES
  ('c5cd0000-0000-0000-0000-000000000001', 'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2', 'c5c10000-0000-0000-0000-000000000001',
   'c5c50000-0000-0000-0000-000000000001', 'approved', 'rsvp', 'self_registration', 'c5c00000-0000-0000-0000-000000000001'),
  ('c5cd0000-0000-0000-0000-000000000002', 'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2', 'c5c10000-0000-0000-0000-000000000001',
   'c5c50000-0000-0000-0000-000000000002', 'approved', 'rsvp', 'self_registration', NULL);
-- Mail zgloszenia ofiary poszedl na JEJ adres - przed podmiana.
INSERT INTO public.email_send_log (tenant_id, template_name, recipient_email, status, metadata) VALUES
  ('c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2', 'event_registration_confirmed', 'victim.r12@example.org', 'sent',
   jsonb_build_object('idempotency_key', 'event-registration:c5cd0000-0000-0000-0000-000000000002:created'));

CREATE TEMP TABLE r12h (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON r12h TO authenticated;
CREATE FUNCTION pg_temp.r12h(p_uid uuid, p_ip text, p_payload jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.event_register_for_client(
    'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2', p_uid, p_ip, 'harness/25r12', p_payload)
$$;

SELECT pg_temp.act_as(NULL, NULL);
SELECT set_config('nes.public_tenant', 'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2', false);

-- 1) KONTO ZALOZONE PRZEZ ADMINISTRATORA ------------------------------------------
INSERT INTO r12h VALUES ('prov', pg_temp.r12h('c5c00000-0000-0000-0000-000000000005', 'ip:' || repeat('c5', 16),
  jsonb_build_object('event_slug', 'r12-glowne', 'email', 'prov.r12@example.org', 'first_name', 'Mallory',
    'last_name', 'Renamed', 'phone', '+48 999 000 999', 'consent_data_processing', true,
    'consent_marketing', true, 'lang', 'pl', 'consent_text_version', 1)));
SELECT pg_temp.assert(
  NOT public._event_uid_owns_email('c5c00000-0000-0000-0000-000000000005', 'prov.r12@example.org')
  AND (SELECT v->'client'->>'outcome' = 'check_email' FROM r12h WHERE k = 'prov')
  AND (SELECT user_id IS NULL AND first_name = 'Prawdziwa' AND phone = '+48 500 000 000'
         FROM public.event_people WHERE id = 'c5c50000-0000-0000-0000-000000000003'),
  '25r12/konto administratora: nie jest wlascicielem adresu - bez dowiazania i bez nadpisania kartoteki');

-- 2) DOWIAZANY BEZ POTWIERDZONEGO ADRESU ----------------------------------------
INSERT INTO r12h VALUES ('z', pg_temp.r12h('c5c00000-0000-0000-0000-000000000001', 'ip:' || repeat('c6', 16),
  jsonb_build_object('event_slug', 'r12-drugie', 'email', 'kolega.r12@example.org', 'first_name', 'Changed',
    'last_name', 'ByZ', 'phone', '+48 111 222 333', 'consent_data_processing', true,
    'consent_marketing', true, 'consent_partner_sharing', true, 'lang', 'pl', 'consent_text_version', 1)));
SELECT pg_temp.assert(
  (SELECT v->'client'->>'outcome' = 'check_email' FROM r12h WHERE k = 'z')
  AND (SELECT first_name = 'Zofia' AND phone = '+48 500 100 100'
         FROM public.event_people WHERE id = 'c5c50000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE person_id = 'c5c50000-0000-0000-0000-000000000001'
                     AND evidence = 'verified_account')
  AND (SELECT r.submitted_profile->>'last_name' = 'ByZ' FROM public.event_registrations r
        WHERE r.person_id = 'c5c50000-0000-0000-0000-000000000001'
          AND r.event_id = 'c5c10000-0000-0000-0000-000000000002'),
  '25r12/dowiazany bez potwierdzonego adresu: kartoteka nietknieta, submitted_profile, bez verified_account');

-- 3) ORGANIZATOR ZMIENIA ADRES OSOBY ------------------------------------------------
SELECT pg_temp.act_as('c5c00000-0000-0000-0000-000000000003', 'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2');
SET ROLE authenticated;
SELECT public.admin_event_registration_upsert(jsonb_build_object(
  'registration_id', 'c5cd0000-0000-0000-0000-000000000001', 'email', 'y.r12@example.org'));
RESET ROLE;
SELECT pg_temp.act_as(NULL, NULL);
INSERT INTO r12h VALUES ('y', pg_temp.r12h('c5c00000-0000-0000-0000-000000000002', 'ip:' || repeat('c7', 16),
  jsonb_build_object('event_slug', 'r12-trzecie', 'email', 'y.r12@example.org', 'first_name', 'Yga',
    'last_name', 'Why', 'consent_data_processing', true)));
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.event_person_account_unbinds
           WHERE person_id = 'c5c50000-0000-0000-0000-000000000001'
             AND user_id = 'c5c00000-0000-0000-0000-000000000001'
             AND reason = 'admin_unbind' AND email_norm = 'y.r12@example.org')
  AND (SELECT user_id = 'c5c00000-0000-0000-0000-000000000002'
         FROM public.event_people WHERE id = 'c5c50000-0000-0000-0000-000000000001'),
  '25r12/zmiana adresu przez organizatora: konto odwiazane (admin_unbind), kartoteka dla wlasciciela nowego adresu');

-- 4) PRZEGLAD: PRZEJECIE Z PODMIANA ADRESU -----------------------------------------
SELECT pg_temp.act_as('c5c00000-0000-0000-0000-000000000003', 'c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2');
SET ROLE authenticated;
INSERT INTO r12h VALUES ('screen', public.admin_event_people_account_bindings('{}'::jsonb));
RESET ROLE;
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_people_account_binding_audit('c5c2c5c2-c5c2-c5c2-c5c2-c5c2c5c2c5c2')
               WHERE person_id = 'c5c50000-0000-0000-0000-000000000002')
  AND (SELECT jsonb_path_exists(v, '$.suspect[*] ? (@.person_id == "c5c50000-0000-0000-0000-000000000002" && @.mails_elsewhere == 1)')
         FROM r12h WHERE k = 'screen'),
  '25r12/przeglad: przejecie z podmiana adresu poza audytem, na liscie suspect ekranu organizatora');

ROLLBACK;
SELECT set_config('nes.public_tenant', '', false);
SELECT pg_temp.act_as(NULL, NULL);
