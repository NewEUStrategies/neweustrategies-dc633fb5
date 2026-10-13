-- pgTAP: poprawki przegladu adwersarialnego R12 (tozsamosc kartoteki i zgody;
-- REG-01, REG-02, REG-14, REG-15). Migracje 20261012180500..180900, 20261012190100.
--
-- CO TEN PLIK DOWODZI (kazda grupa oblewa sie na ciele sprzed poprawki -
-- mutacje opisane w raporcie jednostki FIX-R12):
--   1. Link wypisu z tokenem GLOBALNYM wycofuje marketing wydarzen w KAZDYM
--      najemcy z osoba o tym adresie, takze spoza najemcy domyslnego.
--   2. Konto DOWIAZANE do osoby, ale bez potwierdzonego jej adresu, nie jest
--      wlascicielem: kartoteka nietknieta, `submitted_profile`, zgody `pending`
--      (zapis) i bez nadpisania (zaproszenie z pakietu). Zmiana adresu osoby
--      przez organizatora (wpis i prelegent) odwiazuje konto z wpisem
--      `admin_unbind`; konto, ktore nowy adres potwierdzilo, zostaje.
--   3. Przejecie z podmiana adresu (dowiazanie spelnia D1) trafia na liste
--      PRZEGLADU (`suspect_takeover`), nie do audytu i nie do automatycznego
--      odwiazania; gosc, ktory pozniej zalozyl konto - nie trafia.
--   4. Konto zalozone przez administratora z `email_confirm: true` nie jest
--      wlascicielem adresu (znacznik `app_metadata` i rejestr z zaproszen);
--      potwierdzona zmiana adresu zdejmuje blokade; naprawa historii
--      odwiazuje jego dowiazania (`admin_provisioned`).
--   5. Formularz kontaktowy nie wlacza `crm_leads.marketing_consent`.
--   6. Odznaczenie zgody przez personel CRM zostawia wiersz given=false
--      i most wydarzen jej nie wskrzesza.
--   7. Uwagi: LIMIT listy po ryzyku, zwijanie wielkosci liter tylko A-Z.
--
-- UWAGA (7, 'vİctim.com'): asercja rozroznia stare cialo tylko w bazie
-- z LC_CTYPE UTF-8 (CI: Supabase). Lokalny runner z `--locale=C` zwija
-- wylacznie ASCII i przepuszcza obie wersje - stad dodatkowa asercja
-- strukturalna (COLLATE "C" w ciele funkcji).
BEGIN;
SELECT plan(46);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('f12a0000-0000-0000-0000-0000000000aa', 'r12f-a', 'R12 Fix A', 'r12f-a.example'),
  ('f12a0000-0000-0000-0000-0000000000bb', 'r12f-b', 'R12 Fix B', 'r12f-b.example'),
  ('f12a0000-0000-0000-0000-0000000000cc', 'r12f-c', 'R12 Fix C', 'r12f-c.example');

-- Konta (wszystkie potwierdzone; wyjatki opisane przy wierszu).
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('f12b0000-0000-0000-0000-000000000001', 'z@r12f.example', now()),        -- Z: dowiazany do osoby colleague@
  ('f12b0000-0000-0000-0000-000000000002', 'y@r12f.example', now()),        -- Y: wlasciciel y@
  ('f12b0000-0000-0000-0000-000000000003', 'admin-a@r12f.example', now()),  -- administrator A
  ('f12b0000-0000-0000-0000-000000000004', 'attacker@r12f.example', now()), -- T: przejecie z podmiana
  ('f12b0000-0000-0000-0000-000000000005', 'u@r12f.example', now()),        -- U: gosc, potem konto
  ('f12b0000-0000-0000-0000-000000000006', 'member@r12f.example', now()),   -- Q: czlonek bez roli
  ('f12b0000-0000-0000-0000-000000000007', 'edit@r12f.example', now()),     -- E: osoba zmieniona przez organizatora
  ('f12b0000-0000-0000-0000-000000000008', 'f-new@r12f.example', now()),    -- F: konto potwierdzilo nowy adres
  ('f12b0000-0000-0000-0000-000000000009', 'spk@r12f.example', now()),      -- S: prelegent
  ('f12b0000-0000-0000-0000-00000000000a', 'own2@r12f.example', now()),     -- O: zgloszenie innego konta
  ('f12b0000-0000-0000-0000-00000000000b', 'kate@vİctim.com', now()),       -- K: U+0130 w domenie
  ('f12b0000-0000-0000-0000-00000000000c', 'z2@r12f.example', now()),       -- Z2: zaproszenie z pakietu
  ('f12b0000-0000-0000-0000-00000000000d', 'admin-c@r12f.example', now()),  -- administrator C (LIMIT)
  ('f12b0000-0000-0000-0000-00000000000e', 'staffed@r12f.example', now());  -- osoba ze zgloszeniem personelu
-- Konta zalozone przez administratora (`createUser({ email_confirm: true })`).
INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data) VALUES
  ('f12b0000-0000-0000-0000-000000000011', 'victimb@r12f.example', now(),
   '{"provider":"email","providers":["email"],"provisioned_by_admin":true,"provisioned_email":"victimb@r12f.example"}'),
  -- P2: potwierdzona zmiana adresu po zalozeniu (adres konta != adres z znacznika).
  ('f12b0000-0000-0000-0000-000000000012', 'new-own@r12f.example', now(),
   '{"provisioned_by_admin":true,"provisioned_email":"old-prov@r12f.example"}'),
  -- R: konto zalozone przez administratora, samo zalozylo osobe na swoj adres.
  ('f12b0000-0000-0000-0000-000000000013', 'rprov@r12f.example', now(),
   '{"provisioned_by_admin":true,"provisioned_email":"rprov@r12f.example"}');
-- Konta do wypelnienia rejestru z zaproszen (bez znacznika app_metadata).
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at) VALUES
  ('f12b0000-0000-0000-0000-000000000021', 'inv@r12f.example', now(), '{"must_change_password":true}', now()),
  ('f12b0000-0000-0000-0000-000000000022', 'magic@r12f.example', now(), '{}', now()),
  ('f12b0000-0000-0000-0000-000000000023', 'self@r12f.example', now(), '{}', now() - interval '10 days');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('f12b0000-0000-0000-0000-000000000003', 'admin-a@r12f.example', 'R12F Admin A', 'f12a0000-0000-0000-0000-0000000000aa'),
  ('f12b0000-0000-0000-0000-000000000006', 'member@r12f.example', 'R12F Member', 'f12a0000-0000-0000-0000-0000000000aa'),
  ('f12b0000-0000-0000-0000-00000000000d', 'admin-c@r12f.example', 'R12F Admin C', 'f12a0000-0000-0000-0000-0000000000cc');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('f12b0000-0000-0000-0000-000000000003', 'admin', 'f12a0000-0000-0000-0000-0000000000aa'),
  ('f12b0000-0000-0000-0000-00000000000d', 'admin', 'f12a0000-0000-0000-0000-0000000000cc');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('f12e0000-0000-0000-0000-0000000000e1', 'f12a0000-0000-0000-0000-0000000000aa', 'r12f-e1', 'E1', 'E1', now() + interval '30 days', 'published'),
  ('f12e0000-0000-0000-0000-0000000000e2', 'f12a0000-0000-0000-0000-0000000000aa', 'r12f-e2', 'E2', 'E2', now() + interval '30 days', 'published'),
  ('f12e0000-0000-0000-0000-0000000000e3', 'f12a0000-0000-0000-0000-0000000000aa', 'r12f-e3', 'E3', 'E3', now() + interval '30 days', 'published'),
  ('f12e0000-0000-0000-0000-0000000000e4', 'f12a0000-0000-0000-0000-0000000000aa', 'r12f-e4', 'E4', 'E4', now() + interval '30 days', 'published'),
  ('f12e0000-0000-0000-0000-0000000000eb', 'f12a0000-0000-0000-0000-0000000000bb', 'r12f-eb', 'EB', 'EB', now() + interval '30 days', 'published');

-- Osoby najemcy A.
INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, phone, created_by) VALUES
  -- Z dowiazany do osoby z adresem colleague@, ktorego nie potwierdzil (dryf).
  ('f12c0000-0000-0000-0000-0000000000a1', 'f12a0000-0000-0000-0000-0000000000aa',
   'f12b0000-0000-0000-0000-000000000001', 'colleague@r12f.example', 'Zofia', 'Zet', '+48 500 100 100',
   'f12b0000-0000-0000-0000-000000000001'),
  -- E: osoba E, zgloszenie na E1; organizator zmieni adres na y@.
  ('f12c0000-0000-0000-0000-0000000000a2', 'f12a0000-0000-0000-0000-0000000000aa',
   'f12b0000-0000-0000-0000-000000000007', 'edit@r12f.example', 'Edyta', 'Edit', NULL,
   'f12b0000-0000-0000-0000-000000000007'),
  -- F: kartoteka ma stary adres, konto potwierdzilo f-new@.
  ('f12c0000-0000-0000-0000-0000000000a3', 'f12a0000-0000-0000-0000-0000000000aa',
   'f12b0000-0000-0000-0000-000000000008', 'f-old@r12f.example', 'Filip', 'Fix', NULL,
   'f12b0000-0000-0000-0000-000000000008'),
  -- S: prelegent dowiazany do konta.
  ('f12c0000-0000-0000-0000-0000000000a4', 'f12a0000-0000-0000-0000-0000000000aa',
   'f12b0000-0000-0000-0000-000000000009', 'spk@r12f.example', 'Sara', 'Speaker', NULL,
   'f12b0000-0000-0000-0000-000000000009'),
  -- T: kartoteka ofiary (gosc, created_by NULL), adres przestawiony na T.
  ('f12c0000-0000-0000-0000-0000000000a5', 'f12a0000-0000-0000-0000-0000000000aa',
   'f12b0000-0000-0000-0000-000000000004', 'attacker@r12f.example', 'Vera', 'Victim', '+48 600 111 222', NULL),
  -- U: gosc, ktory pozniej zalozyl konto na ten sam adres (uczciwe).
  ('f12c0000-0000-0000-0000-0000000000a6', 'f12a0000-0000-0000-0000-0000000000aa',
   'f12b0000-0000-0000-0000-000000000005', 'u@r12f.example', 'Urban', 'Uczciwy', NULL, NULL),
  -- O: zgloszenie tej osoby zalozyl czlonek Q (inne konto, nie personel).
  ('f12c0000-0000-0000-0000-0000000000a7', 'f12a0000-0000-0000-0000-0000000000aa',
   'f12b0000-0000-0000-0000-00000000000a', 'own2@r12f.example', 'Olga', 'Owner', NULL, NULL),
  -- Osoba ze zgloszeniem zalozonym przez administratora (personel) - nie sygnal.
  ('f12c0000-0000-0000-0000-0000000000a8', 'f12a0000-0000-0000-0000-0000000000aa',
   'f12b0000-0000-0000-0000-00000000000e', 'staffed@r12f.example', 'Stefan', 'Staffed', NULL, NULL),
  -- R: konto zalozone przez administratora, samo zalozylo osobe.
  ('f12c0000-0000-0000-0000-0000000000a9', 'f12a0000-0000-0000-0000-0000000000aa',
   'f12b0000-0000-0000-0000-000000000013', 'rprov@r12f.example', 'Roman', 'Provisioned', NULL,
   'f12b0000-0000-0000-0000-000000000013'),
  -- Z2 dowiazany do osoby z adresem zaproszenia, ktorego nie potwierdzil.
  ('f12c0000-0000-0000-0000-0000000000aa', 'f12a0000-0000-0000-0000-0000000000aa',
   'f12b0000-0000-0000-0000-00000000000c', 'colleague-inv@r12f.example', 'Zenon', 'Zaproszony', NULL,
   'f12b0000-0000-0000-0000-00000000000c');
-- Osoba najemcy B o adresie konta zalozonego przez administratora A.
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name, phone, consent_data_processing_at) VALUES
  ('f12c0000-0000-0000-0000-0000000000b1', 'f12a0000-0000-0000-0000-0000000000bb',
   'victimb@r12f.example', 'Bea', 'Real', '+48 500 000 000', now());

INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status, registration_mode, created_by) VALUES
  ('f12d0000-0000-0000-0000-0000000000a2', 'f12a0000-0000-0000-0000-0000000000aa', 'f12e0000-0000-0000-0000-0000000000e1',
   'f12c0000-0000-0000-0000-0000000000a2', 'approved', 'rsvp', 'f12b0000-0000-0000-0000-000000000007'),
  ('f12d0000-0000-0000-0000-0000000000a5', 'f12a0000-0000-0000-0000-0000000000aa', 'f12e0000-0000-0000-0000-0000000000e1',
   'f12c0000-0000-0000-0000-0000000000a5', 'approved', 'rsvp', NULL),
  ('f12d0000-0000-0000-0000-0000000000a6', 'f12a0000-0000-0000-0000-0000000000aa', 'f12e0000-0000-0000-0000-0000000000e1',
   'f12c0000-0000-0000-0000-0000000000a6', 'approved', 'rsvp', NULL),
  ('f12d0000-0000-0000-0000-0000000000a7', 'f12a0000-0000-0000-0000-0000000000aa', 'f12e0000-0000-0000-0000-0000000000e1',
   'f12c0000-0000-0000-0000-0000000000a7', 'approved', 'rsvp', 'f12b0000-0000-0000-0000-000000000006'),
  ('f12d0000-0000-0000-0000-0000000000a8', 'f12a0000-0000-0000-0000-0000000000aa', 'f12e0000-0000-0000-0000-0000000000e1',
   'f12c0000-0000-0000-0000-0000000000a8', 'approved', 'rsvp', 'f12b0000-0000-0000-0000-000000000003');

-- Dziennik poczty: mail zgloszenia ofiary poszedl na JEJ adres (przed
-- podmiana); mail goscia U - na ten sam adres co dzis.
INSERT INTO public.email_send_log (tenant_id, template_name, recipient_email, status, metadata) VALUES
  ('f12a0000-0000-0000-0000-0000000000aa', 'event_registration_confirmed', 'victim@r12f.example', 'sent',
   jsonb_build_object('idempotency_key', 'event-registration:f12d0000-0000-0000-0000-0000000000a5:created')),
  ('f12a0000-0000-0000-0000-0000000000aa', 'event_registration_confirmed', 'u@r12f.example', 'sent',
   jsonb_build_object('idempotency_key', 'event-registration:f12d0000-0000-0000-0000-0000000000a6:created'));

CREATE TEMP TABLE r12f (k text PRIMARY KEY, v jsonb);
GRANT ALL ON r12f TO anon, authenticated, service_role;

-- ── 1-2. ACL ────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_account_admin_provisioned(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_account_admin_provisioned(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._auth_admin_provisioned_backfill()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_people_account_binding_review(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_people_account_binding_review(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_person_email_edit_unbind(uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_people_account_binding_review(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._auth_admin_provisioned_backfill()', 'EXECUTE'),
  'pomocnicze R12 (znacznik konta, backfill, przeglad, odwiazanie po edycji): tylko service_role');
SELECT ok(
  has_function_privilege('authenticated', 'public.crm_leads_marketing_consent_withdraw(uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.crm_leads_marketing_consent_withdraw(uuid[])', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.auth_admin_provisioned_accounts', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.auth_admin_provisioned_accounts', 'SELECT'),
  'odznaczenie zgody w CRM: authenticated (bramka roli w funkcji), anon nie; rejestr kont tylko serwer');

-- ── 3-6. (1) Link wypisu: token globalny, uczestnik najemcy spoza domyslnego ─
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name, consent_data_processing_at) VALUES
  ('f12c0000-0000-0000-0000-0000000000b2', 'f12a0000-0000-0000-0000-0000000000bb', 'pb@r12f.example', 'Pia', 'B', now()),
  ('f12c0000-0000-0000-0000-0000000000c2', 'f12a0000-0000-0000-0000-0000000000cc', 'pb@r12f.example', 'Pia', 'C', now()),
  ('f12c0000-0000-0000-0000-0000000000b3', 'f12a0000-0000-0000-0000-0000000000bb', 'ns@r12f.example', 'Nina', 'B', now()),
  ('f12c0000-0000-0000-0000-0000000000c3', 'f12a0000-0000-0000-0000-0000000000cc', 'ns@r12f.example', 'Nina', 'C', now());
SELECT public._event_person_consents_confirm(t.tenant, t.person, ARRAY['marketing'], 'verified_account',
         NULL, NULL, NULL, 1, 'pl', NULL, NULL, NULL, 'probe', true)
  FROM (VALUES
    ('f12a0000-0000-0000-0000-0000000000bb'::uuid, 'f12c0000-0000-0000-0000-0000000000b2'::uuid),
    ('f12a0000-0000-0000-0000-0000000000cc'::uuid, 'f12c0000-0000-0000-0000-0000000000c2'::uuid),
    ('f12a0000-0000-0000-0000-0000000000bb'::uuid, 'f12c0000-0000-0000-0000-0000000000b3'::uuid),
    ('f12a0000-0000-0000-0000-0000000000cc'::uuid, 'f12c0000-0000-0000-0000-0000000000c3'::uuid)) AS t(tenant, person);
INSERT INTO public.crm_leads (tenant_id, email, email_norm, marketing_consent) VALUES
  ('f12a0000-0000-0000-0000-0000000000bb', 'pb@r12f.example', 'pb@r12f.example', true),
  ('f12a0000-0000-0000-0000-0000000000cc', 'pb@r12f.example', 'pb@r12f.example', true);
-- Token globalny poczty systemowej: jeden na adres, bez najemcy (ensureUnsubscribeToken).
INSERT INTO public.email_unsubscribe_tokens (token, email) VALUES ('r12f-global-token', 'pb@r12f.example');
INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, unsubscribe_token) VALUES
  ('f12a0000-0000-0000-0000-0000000000bb', 'ns@r12f.example', 'subscribed', 'pl', 'r12f-newsletter-token');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO r12f VALUES ('unsub_global', public.email_unsubscribe_by_token('r12f-global-token'));
INSERT INTO r12f VALUES ('unsub_ns', public.email_unsubscribe_by_token('r12f-newsletter-token'));
RESET ROLE;

SELECT ok(
  (SELECT v->>'ok' = 'true' FROM r12f WHERE k = 'unsub_global')
  AND (SELECT bool_and(consent_marketing_at IS NULL) FROM public.event_people
        WHERE id IN ('f12c0000-0000-0000-0000-0000000000b2', 'f12c0000-0000-0000-0000-0000000000c2')),
  'token globalny: marketing wydarzen wycofany w KAZDYM najemcy z osoba o tym adresie (uczestnik najemcy spoza domyslnego)');
SELECT is(
  (SELECT count(*)::int FROM public.event_consent_records
    WHERE person_id IN ('f12c0000-0000-0000-0000-0000000000b2', 'f12c0000-0000-0000-0000-0000000000c2')
      AND purpose = 'marketing' AND status = 'withdrawn' AND evidence = 'unsubscribe_link'),
  2,
  'token globalny: wpis ksiegi withdrawn/unsubscribe_link w obu najemcach');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.crm_leads
               WHERE email_norm = 'pb@r12f.example' AND marketing_consent
                 AND tenant_id IN ('f12a0000-0000-0000-0000-0000000000bb', 'f12a0000-0000-0000-0000-0000000000cc')),
  'token globalny: CRM obu najemcow bez zgody marketingowej');
SELECT ok(
  (SELECT consent_marketing_at IS NULL FROM public.event_people WHERE id = 'f12c0000-0000-0000-0000-0000000000b3')
  AND (SELECT consent_marketing_at IS NOT NULL FROM public.event_people WHERE id = 'f12c0000-0000-0000-0000-0000000000c3'),
  'token subskrybenta newslettera: wycofanie tylko w najemcy wiersza subskrypcji (bez zmian)');

-- ── 7-10. (2) Dowiazany bez potwierdzonego adresu: zapis -> sciezka obcego ──
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO r12f VALUES ('z_reg', public.event_register_for_client(
  'f12a0000-0000-0000-0000-0000000000aa', 'f12b0000-0000-0000-0000-000000000001',
  'ip:' || repeat('a1', 16), 'r12f/1',
  jsonb_build_object('event_slug', 'r12f-e3', 'email', 'colleague@r12f.example',
    'first_name', 'Changed', 'last_name', 'ByZ', 'phone', '+48 111 222 333',
    'consent_data_processing', true, 'consent_marketing', true, 'consent_partner_sharing', true,
    'lang', 'pl', 'consent_text_version', 1)));
RESET ROLE;
SELECT is((SELECT v->'client'->>'outcome' FROM r12f WHERE k = 'z_reg'), 'check_email',
  'dowiazane konto bez potwierdzonego adresu dostaje stala check_email');
SELECT ok(
  (SELECT first_name = 'Zofia' AND last_name = 'Zet' AND phone = '+48 500 100 100'
     FROM public.event_people WHERE id = 'f12c0000-0000-0000-0000-0000000000a1'),
  'dowiazane konto bez potwierdzonego adresu NIE nadpisuje kartoteki (imie, nazwisko, telefon)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_consent_records
               WHERE person_id = 'f12c0000-0000-0000-0000-0000000000a1'
                 AND purpose IN ('marketing', 'partner_sharing')
                 AND (status = 'confirmed' OR evidence = 'verified_account'))
  AND (SELECT count(*) FROM public.event_consent_records
        WHERE person_id = 'f12c0000-0000-0000-0000-0000000000a1'
          AND purpose IN ('marketing', 'partner_sharing') AND status = 'pending') = 2,
  'dowiazane konto bez potwierdzonego adresu: marketing/partnerzy jako pending (DOI), nigdy verified_account');
SELECT ok(
  (SELECT r.submitted_profile->>'first_name' = 'Changed'
     FROM public.event_registrations r
    WHERE r.person_id = 'f12c0000-0000-0000-0000-0000000000a1'
      AND r.event_id = 'f12e0000-0000-0000-0000-0000000000e3'),
  'to, co przyslalo dowiazane, niezweryfikowane konto - w submitted_profile zgloszenia');

-- ── 11-12. (2) Zaproszenie z pakietu: dowiazany bez potwierdzonego adresu ────
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency) VALUES
  ('f1270000-0000-0000-0000-0000000000a1', 'f12a0000-0000-0000-0000-0000000000aa', 'f12e0000-0000-0000-0000-0000000000e2',
   'r12f_std', 'Standard', 'Standard', 20000, 'PLN');
INSERT INTO public.event_ticket_packages (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, audience, seats, price_cents, currency) VALUES
  ('f1280000-0000-0000-0000-0000000000a1', 'f12a0000-0000-0000-0000-0000000000aa', 'f12e0000-0000-0000-0000-0000000000e2',
   'f1270000-0000-0000-0000-0000000000a1', 'r12f_pack', 'Pakiet', 'Pack', 'public', 2, 30000, 'PLN');
INSERT INTO public.event_package_orders (id, tenant_id, event_id, package_id, buyer_email, seats_total, status, amount_cents, paid_at) VALUES
  ('f1290000-0000-0000-0000-0000000000a1', 'f12a0000-0000-0000-0000-0000000000aa', 'f12e0000-0000-0000-0000-0000000000e2',
   'f1280000-0000-0000-0000-0000000000a1', 'buyer@r12f.example', 2, 'paid', 30000, now());
INSERT INTO public.event_package_seats (id, tenant_id, event_id, package_order_id, invite_email, invite_name,
  invite_token_hash, invite_sent_at, invite_expires_at) VALUES
  ('f12f0000-0000-0000-0000-0000000000a1', 'f12a0000-0000-0000-0000-0000000000aa', 'f12e0000-0000-0000-0000-0000000000e2',
   'f1290000-0000-0000-0000-0000000000a1', 'colleague-inv@r12f.example', 'Kolega',
   encode(extensions.digest('r12fINV' || repeat('q', 25), 'sha256'), 'hex'), now(), now() + interval '7 days');
SELECT set_config('request.headers', '{"x-tenant-host":"r12f-a.example"}', true);
SELECT set_config('request.jwt.claim.sub', 'f12b0000-0000-0000-0000-00000000000c', true);
SELECT set_config('request.jwt.claims', '{"sub":"f12b0000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO r12f VALUES ('z2_inv', public.event_package_invite_accept(jsonb_build_object(
  'token', 'r12fINV' || repeat('q', 25), 'first_name', 'Changed', 'last_name', 'ByZ2',
  'job_title', 'Nowa rola', 'consent_data_processing', true, 'answers', '{}'::jsonb,
  'accepted_term_ids', '[]'::jsonb)));
RESET ROLE;
SELECT ok(
  (SELECT v->>'ok' = 'true' FROM r12f WHERE k = 'z2_inv')
  AND (SELECT first_name = 'Zenon' AND last_name = 'Zaproszony' AND job_title IS NULL
         FROM public.event_people WHERE id = 'f12c0000-0000-0000-0000-0000000000aa'),
  'zaproszenie: dowiazane konto bez potwierdzonego adresu zaproszenia NIE nadpisuje kartoteki');
SELECT ok(
  (SELECT r.submitted_profile->>'last_name' = 'ByZ2'
     FROM public.event_registrations r
    WHERE r.person_id = 'f12c0000-0000-0000-0000-0000000000aa'
      AND r.event_id = 'f12e0000-0000-0000-0000-0000000000e2'),
  'zaproszenie: dane dowiazanego, niezweryfikowanego konta w submitted_profile');

-- ── 13-17. (2) Organizator zmienia adres osoby dowiazanej ───────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"r12f-a.example"}', true);
SELECT set_config('request.jwt.claim.sub', 'f12b0000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"f12b0000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.admin_event_registration_upsert(jsonb_build_object(
  'registration_id', 'f12d0000-0000-0000-0000-0000000000a2', 'email', 'y@r12f.example'));
SELECT public.admin_event_registration_upsert(jsonb_build_object(
  'event_id', 'f12e0000-0000-0000-0000-0000000000e1', 'person_id', 'f12c0000-0000-0000-0000-0000000000a3',
  'email', 'f-new@r12f.example'));
SELECT public.admin_event_speaker_upsert(jsonb_build_object(
  'event_id', 'f12e0000-0000-0000-0000-0000000000e1', 'person_id', 'f12c0000-0000-0000-0000-0000000000a4',
  'email', 'other-spk@r12f.example'));
RESET ROLE;
SELECT is(
  (SELECT user_id FROM public.event_people WHERE id = 'f12c0000-0000-0000-0000-0000000000a2'),
  NULL::uuid,
  'zmiana adresu przez organizatora odwiazuje konto, ktore nowego adresu nie potwierdzilo');
SELECT ok(
  EXISTS (SELECT 1 FROM public.event_person_account_unbinds b
           WHERE b.tenant_id = 'f12a0000-0000-0000-0000-0000000000aa'
             AND b.person_id = 'f12c0000-0000-0000-0000-0000000000a2'
             AND b.user_id = 'f12b0000-0000-0000-0000-000000000007'
             AND b.reason = 'admin_unbind' AND b.email_norm = 'y@r12f.example'
             AND b.account_email_norm = 'edit@r12f.example'
             AND b.unbound_by = 'f12b0000-0000-0000-0000-000000000003'),
  'odwiazanie po zmianie adresu zapisane w dzienniku (admin_unbind, nowy adres, organizator)');
SELECT ok(
  (SELECT user_id = 'f12b0000-0000-0000-0000-000000000008' AND email_norm = 'f-new@r12f.example'
     FROM public.event_people WHERE id = 'f12c0000-0000-0000-0000-0000000000a3')
  AND NOT EXISTS (SELECT 1 FROM public.event_person_account_unbinds
                   WHERE person_id = 'f12c0000-0000-0000-0000-0000000000a3'),
  'nowy adres potwierdzony przez dowiazane konto - dowiazanie zostaje (D1 spelnione)');
SELECT ok(
  (SELECT user_id IS NULL FROM public.event_people WHERE id = 'f12c0000-0000-0000-0000-0000000000a4')
  AND EXISTS (SELECT 1 FROM public.event_person_account_unbinds
               WHERE person_id = 'f12c0000-0000-0000-0000-0000000000a4' AND reason = 'admin_unbind'),
  'prelegent: zmiana adresu przez organizatora tez odwiazuje konto (wpis admin_unbind)');

-- Wlasciciel nowego adresu (Y) zapisuje sie: zgloszenie trafia do NIEGO.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO r12f VALUES ('y_reg', public.event_register_for_client(
  'f12a0000-0000-0000-0000-0000000000aa', 'f12b0000-0000-0000-0000-000000000002',
  'ip:' || repeat('a2', 16), 'r12f/1',
  jsonb_build_object('event_slug', 'r12f-e4', 'email', 'y@r12f.example', 'first_name', 'Yga',
    'last_name', 'Why', 'consent_data_processing', true, 'lang', 'pl', 'consent_text_version', 1)));
RESET ROLE;
SELECT is(
  (SELECT user_id FROM public.event_people WHERE id = 'f12c0000-0000-0000-0000-0000000000a2'),
  'f12b0000-0000-0000-0000-000000000002'::uuid,
  'po zmianie adresu kartoteka nalezy do wlasciciela nowego adresu, nie do dawnego konta');

-- ── 18-23. (3) Lista przegladu: przejecie z podmiana adresu ──────────────────
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_people_account_binding_audit('f12a0000-0000-0000-0000-0000000000aa')
               WHERE person_id = 'f12c0000-0000-0000-0000-0000000000a5'),
  'przejecie z podmiana adresu spelnia D1 - audyt go nie widzi (stad osobna kategoria)');
SELECT ok(
  EXISTS (SELECT 1 FROM public.event_people_account_binding_review('f12a0000-0000-0000-0000-0000000000aa') x
           WHERE x.person_id = 'f12c0000-0000-0000-0000-0000000000a5'
             AND x.risk = 'suspect_takeover' AND x.mails_elsewhere = 1),
  'przejecie z podmiana adresu na liscie przegladu: suspect_takeover, mail zgloszenia na inny adres');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_people_account_binding_review('f12a0000-0000-0000-0000-0000000000aa') x
               WHERE x.person_id IN ('f12c0000-0000-0000-0000-0000000000a6', 'f12c0000-0000-0000-0000-0000000000a8')),
  'gosc, ktory zalozyl konto na swoj adres, i zgloszenie od personelu - bez sygnalu przejecia');
SELECT ok(
  EXISTS (SELECT 1 FROM public.event_people_account_binding_review('f12a0000-0000-0000-0000-0000000000aa') x
           WHERE x.person_id = 'f12c0000-0000-0000-0000-0000000000a7'
             AND x.registrations_by_others = 1 AND x.mails_elsewhere = 0),
  'zgloszenie osoby zalozone przez INNE konto spoza personelu - sygnal registrations_by_others');

SELECT set_config('request.jwt.claim.sub', 'f12b0000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"f12b0000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO r12f VALUES ('screen_a', public.admin_event_people_account_bindings('{}'::jsonb));
INSERT INTO r12f VALUES ('unbind_suspect', public.admin_event_person_account_unbind(
  jsonb_build_object('person_id', 'f12c0000-0000-0000-0000-0000000000a5')));
RESET ROLE;
SELECT ok(
  (SELECT jsonb_path_exists(v, '$.suspect[*] ? (@.person_id == "f12c0000-0000-0000-0000-0000000000a5" && @.mails_elsewhere == 1)')
     FROM r12f WHERE k = 'screen_a'),
  'ekran organizatora pokazuje liste przegladu (suspect) z sygnalem');
SELECT ok(
  (SELECT v->>'risk' = 'suspect_takeover' FROM r12f WHERE k = 'unbind_suspect')
  AND EXISTS (SELECT 1 FROM public.event_person_account_unbinds
               WHERE person_id = 'f12c0000-0000-0000-0000-0000000000a5'
                 AND reason = 'admin_unbind' AND risk = 'suspect_takeover'),
  'odwiazanie osoby z listy przegladu zapisane jako suspect_takeover');

-- ── 24-31. (4) Konto zalozone przez administratora ───────────────────────────
SELECT ok(
  NOT public._event_uid_owns_email('f12b0000-0000-0000-0000-000000000011', 'victimb@r12f.example'),
  'konto zalozone przez administratora (app_metadata.provisioned_by_admin) NIE jest wlascicielem adresu');
SELECT is(
  public._event_bind_uid_for_email('f12a0000-0000-0000-0000-0000000000bb',
    'f12b0000-0000-0000-0000-000000000011', 'victimb@r12f.example'),
  NULL::uuid,
  'konto zalozone przez administratora nie wiaze sie z kartoteka');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO r12f VALUES ('prov_xt', public.event_register_for_client(
  'f12a0000-0000-0000-0000-0000000000bb', 'f12b0000-0000-0000-0000-000000000011',
  'ip:' || repeat('a3', 16), 'r12f/1',
  jsonb_build_object('event_slug', 'r12f-eb', 'email', 'victimb@r12f.example',
    'first_name', 'Mallory', 'last_name', 'Renamed', 'phone', '+48 999 000 999',
    'consent_data_processing', true, 'consent_marketing', true, 'consent_partner_sharing', true,
    'lang', 'pl', 'consent_text_version', 1)));
RESET ROLE;
SELECT ok(
  (SELECT v->'client'->>'outcome' = 'check_email' AND (v->'client') ? 'manage_token' IS FALSE FROM r12f WHERE k = 'prov_xt')
  AND (SELECT user_id IS NULL AND first_name = 'Bea' AND phone = '+48 500 000 000'
         FROM public.event_people WHERE id = 'f12c0000-0000-0000-0000-0000000000b1')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE person_id = 'f12c0000-0000-0000-0000-0000000000b1' AND evidence = 'verified_account'),
  'konto administratora obszaru A na stronie obszaru B: bez dowiazania, nadpisania, klucza i zgod verified_account');
SELECT ok(
  public._event_uid_owns_email('f12b0000-0000-0000-0000-000000000012', 'new-own@r12f.example'),
  'potwierdzona zmiana adresu konta zalozonego przez administratora - nowy adres jest jego');

INSERT INTO public.user_invitations (tenant_id, email, mode, status, auth_user_id, created_at) VALUES
  ('f12a0000-0000-0000-0000-0000000000aa', 'inv@r12f.example', 'temp_password', 'sent',
   'f12b0000-0000-0000-0000-000000000021', now() - interval '1 day'),
  ('f12a0000-0000-0000-0000-0000000000aa', 'magic@r12f.example', 'magic_link', 'sent',
   'f12b0000-0000-0000-0000-000000000022', now() - interval '1 day'),
  ('f12a0000-0000-0000-0000-0000000000aa', 'self@r12f.example', 'temp_password', 'sent',
   'f12b0000-0000-0000-0000-000000000023', now() - interval '1 day');
SELECT ok(
  public._event_uid_owns_email('f12b0000-0000-0000-0000-000000000021', 'inv@r12f.example'),
  'przed wypelnieniem rejestru konto z zaproszenia temp_password wyglada na wlasciciela (stan sprzed znacznika)');
-- Wywolanie osobnym zapytaniem: wiersze wstawione przez funkcje sa widoczne
-- dopiero dla NASTEPNEJ instrukcji (migawka zapytania).
INSERT INTO r12f VALUES ('backfill_1', to_jsonb(public._auth_admin_provisioned_backfill()));
INSERT INTO r12f VALUES ('backfill_2', to_jsonb(public._auth_admin_provisioned_backfill()));
SELECT ok(
  (SELECT (v)::text::int >= 1 FROM r12f WHERE k = 'backfill_1')
  AND EXISTS (SELECT 1 FROM public.auth_admin_provisioned_accounts
               WHERE user_id = 'f12b0000-0000-0000-0000-000000000021'
                 AND email_norm = 'inv@r12f.example' AND source = 'invitation_temp_password')
  AND NOT EXISTS (SELECT 1 FROM public.auth_admin_provisioned_accounts
                   WHERE user_id IN ('f12b0000-0000-0000-0000-000000000022', 'f12b0000-0000-0000-0000-000000000023')),
  'rejestr z zaproszen: temp_password tak; magic_link i konto starsze od zaproszenia bez metadanych - nie');
SELECT ok(
  NOT public._event_uid_owns_email('f12b0000-0000-0000-0000-000000000021', 'inv@r12f.example')
  AND (SELECT v = '0'::jsonb FROM r12f WHERE k = 'backfill_2'),
  'po wypelnieniu rejestru konto z zaproszenia nie jest wlascicielem adresu; ponowne wypelnienie - 0 (idempotentne)');
SELECT is(
  (SELECT risk FROM public.event_people_account_binding_audit('f12a0000-0000-0000-0000-0000000000aa')
    WHERE person_id = 'f12c0000-0000-0000-0000-0000000000a9'),
  'admin_provisioned',
  'dowiazanie konta zalozonego przez administratora w audycie z klasa admin_provisioned');

-- ── 32-33. (5) Formularz kontaktowy nie nadaje zgody marketingowej CRM ──────
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name, consent_data_processing_at) VALUES
  ('f12c0000-0000-0000-0000-0000000000ab', 'f12a0000-0000-0000-0000-0000000000aa', 'w@r12f.example', 'Wanda', 'W', now());
SELECT public._event_person_consents_confirm('f12a0000-0000-0000-0000-0000000000aa', 'f12c0000-0000-0000-0000-0000000000ab',
  ARRAY['marketing'], 'verified_account', NULL, NULL, NULL, 1, 'pl', NULL, NULL, NULL, 'probe', true);
SELECT public._event_person_crm_sync('f12a0000-0000-0000-0000-0000000000aa', 'f12c0000-0000-0000-0000-0000000000ab',
  'event_participant', 'event:probe', '{}', '{}', true, NULL, '{}');
SELECT public._event_person_consents_withdraw('f12a0000-0000-0000-0000-0000000000aa', 'f12c0000-0000-0000-0000-0000000000ab',
  ARRAY['marketing', 'partner_sharing'], 'account_settings', NULL, NULL, NULL, 'probe');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO public.contact_messages (tenant_id, name, email, message, consent, lang) VALUES
  ('f12a0000-0000-0000-0000-0000000000aa', 'Someone Else', 'w@r12f.example', 'hello', true, 'pl');
INSERT INTO public.contact_messages (tenant_id, name, email, message, consent, lang, newsletter_opt_in) VALUES
  ('f12a0000-0000-0000-0000-0000000000aa', 'Nowa Osoba', 'nl@r12f.example', 'hej', true, 'pl', true);
RESET ROLE;
SELECT is(
  (SELECT marketing_consent FROM public.crm_leads
    WHERE tenant_id = 'f12a0000-0000-0000-0000-0000000000aa' AND email_norm = 'w@r12f.example'),
  false,
  'anonimowy formularz kontaktowy (zgoda RODO) nie przywraca zgody marketingowej po wycofaniu');
SELECT ok(
  (SELECT NOT marketing_consent AND newsletter_status = 'pending' FROM public.crm_leads
    WHERE tenant_id = 'f12a0000-0000-0000-0000-0000000000aa' AND email_norm = 'nl@r12f.example'),
  'formularz z zaznaczonym newsletterem: kontakt pending (DOI), bez zgody marketingowej');

-- ── 34-37. (6) Odznaczenie zgody przez personel CRM zatrzymuje most ─────────
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name, consent_data_processing_at) VALUES
  ('f12c0000-0000-0000-0000-0000000000ac', 'f12a0000-0000-0000-0000-0000000000aa', 'crm@r12f.example', 'Cyryl', 'Crm',
   now() - interval '2 days');
SELECT public._event_person_consents_confirm('f12a0000-0000-0000-0000-0000000000aa', 'f12c0000-0000-0000-0000-0000000000ac',
  ARRAY['marketing'], 'verified_account', NULL, NULL, NULL, 1, 'pl', NULL, NULL, NULL, 'probe', true);
SELECT public._event_person_crm_sync('f12a0000-0000-0000-0000-0000000000aa', 'f12c0000-0000-0000-0000-0000000000ac',
  'event_participant', 'event:probe', '{}', '{}', true, NULL, '{}');
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, marketing_consent) VALUES
  ('f12d0000-0000-0000-0000-0000000000cb', 'f12a0000-0000-0000-0000-0000000000bb', 'foreign@r12f.example', 'foreign@r12f.example', true);
SELECT set_config('request.headers', '{"x-tenant-host":"r12f-a.example"}', true);
SELECT set_config('request.jwt.claim.sub', 'f12b0000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"f12b0000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO r12f VALUES ('staff_untick', to_jsonb(public.crm_leads_marketing_consent_withdraw(ARRAY[
  (SELECT id FROM public.crm_leads WHERE tenant_id = 'f12a0000-0000-0000-0000-0000000000aa' AND email_norm = 'crm@r12f.example'),
  'f12d0000-0000-0000-0000-0000000000cb'::uuid])));
RESET ROLE;
SELECT ok(
  (SELECT v = '1'::jsonb FROM r12f WHERE k = 'staff_untick')
  AND (SELECT marketing_consent FROM public.crm_leads WHERE id = 'f12d0000-0000-0000-0000-0000000000cb'),
  'odznaczenie przez personel: 1 kontakt najemcy; kontakt obcego najemcy nietkniety');
SELECT ok(
  EXISTS (SELECT 1 FROM public.crm_consent_log
           WHERE tenant_id = 'f12a0000-0000-0000-0000-0000000000aa' AND lower(email) = 'crm@r12f.example'
             AND consent_key = 'marketing' AND NOT given AND form_id = 'crm_staff:withdraw'),
  'odznaczenie przez personel zostawia wiersz crm_consent_log given=false (zrodlo: personel)');
SELECT public._event_person_crm_sync('f12a0000-0000-0000-0000-0000000000aa', 'f12c0000-0000-0000-0000-0000000000ac',
  'event_participant', 'event:probe:checkin', '{}', '{}', false, NULL, '{}');
SELECT is(
  (SELECT marketing_consent FROM public.crm_leads
    WHERE tenant_id = 'f12a0000-0000-0000-0000-0000000000aa' AND email_norm = 'crm@r12f.example'),
  false,
  'most wydarzen po odznaczeniu przez personel NIE wskrzesza zgody marketingowej');
SELECT set_config('request.jwt.claim.sub', 'f12b0000-0000-0000-0000-000000000006', true);
SELECT set_config('request.jwt.claims', '{"sub":"f12b0000-0000-0000-0000-000000000006","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$SELECT public.crm_leads_marketing_consent_withdraw(ARRAY['f12d0000-0000-0000-0000-0000000000cb'::uuid])$$,
  'forbidden%',
  'odznaczenie zgody w CRM bez roli personelu: forbidden');
RESET ROLE;

-- ── 38-39. (7) Zwijanie wielkosci liter wylacznie A-Z ────────────────────────
SELECT ok(
  NOT public._event_uid_owns_email('f12b0000-0000-0000-0000-00000000000b', 'kate@victim.com'),
  'konto z potwierdzonym kate@vİctim.com (U+0130) nie posiada kate@victim.com');
SELECT ok(
  pg_get_functiondef('public._event_uid_owns_email(uuid,text)'::regprocedure) LIKE '%COLLATE "C"%'
  AND pg_get_functiondef('public._event_account_admin_provisioned(uuid)'::regprocedure) LIKE '%COLLATE "C"%',
  'porownanie adresow konta i kartoteki z kolacja "C" (zwijanie tylko ASCII) niezaleznie od LC_CTYPE bazy');

-- ── 40-41. (7) LIMIT listy niezweryfikowanych PO ryzyku ──────────────────────
-- 201 dowiazan self_created (adres sluzbowy) i jedno foreign_record z NAJWIEKSZYM
-- person_id - stary LIMIT po person_id ucinal dokladnie je.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT ('f12a1000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'lim' || g || '@r12f.example', now()
  FROM generate_series(1, 202) g;
INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, created_by)
SELECT ('f12a2000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'f12a0000-0000-0000-0000-0000000000cc',
       ('f12a1000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'work' || g || '@r12f.example',
       'Lim', 'Self' || g, ('f12a1000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid
  FROM generate_series(1, 201) g;
INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, created_by) VALUES
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'f12a0000-0000-0000-0000-0000000000cc',
   'f12a1000-0000-0000-0000-000000000202', 'zz-victim@r12f.example', 'Zuzanna', 'Zagrozona', NULL);
SELECT set_config('request.jwt.claim.sub', 'f12b0000-0000-0000-0000-00000000000d', true);
SELECT set_config('request.jwt.claims', '{"sub":"f12b0000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO r12f VALUES ('screen_c', public.admin_event_people_account_bindings('{}'::jsonb));
RESET ROLE;
SELECT is(
  (SELECT jsonb_array_length(v->'unverified') FROM r12f WHERE k = 'screen_c'),
  200,
  'lista niezweryfikowanych: najwyzej 200 wierszy');
SELECT is(
  (SELECT v->'unverified'->0->>'person_id' FROM r12f WHERE k = 'screen_c'),
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'LIMIT po uporzadkowaniu wedlug ryzyka: foreign_record jest na liscie (i pierwszy), choc ma najwiekszy person_id');

-- ── 42-46. Naprawa historii po R12 (20261012190100) ──────────────────────────
SELECT ok(public._event_people_unbind_unverified('reg01_remediation') >= 1,
  'naprawa historii po R12 odwiazuje dowiazania, ktore przestaly spelniac D1');
SELECT ok(
  (SELECT user_id IS NULL FROM public.event_people WHERE id = 'f12c0000-0000-0000-0000-0000000000a9')
  AND EXISTS (SELECT 1 FROM public.event_person_account_unbinds
               WHERE person_id = 'f12c0000-0000-0000-0000-0000000000a9'
                 AND reason = 'reg01_remediation' AND risk = 'admin_provisioned'),
  'konto zalozone przez administratora odwiazane z wpisem admin_provisioned');
SELECT ok(
  (SELECT user_id = 'f12b0000-0000-0000-0000-00000000000a' FROM public.event_people WHERE id = 'f12c0000-0000-0000-0000-0000000000a7'),
  'lista przegladu NIE jest odwiazywana automatycznie (decyzja organizatora)');
SELECT is_empty(
  $$SELECT 1 FROM public.event_people_account_binding_audit('f12a0000-0000-0000-0000-0000000000aa')$$,
  'po naprawie audyt najemcy zwraca 0 wierszy');
SELECT throws_like(
  $$INSERT INTO public.event_person_account_unbinds (tenant_id, person_id, risk, reason)
    VALUES ('f12a0000-0000-0000-0000-0000000000aa', 'f12c0000-0000-0000-0000-0000000000a7', 'suspect_takeover', 'reg01_remediation')$$,
  '%event_person_account_unbinds_remediation_unverified%',
  'naprawa historii nie moze zapisac suspect_takeover (CHECK)');

SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
