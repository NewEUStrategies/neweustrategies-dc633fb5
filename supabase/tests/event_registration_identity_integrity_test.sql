-- pgTAP: zapis na wydarzenie nie przejmuje ani nie przepisuje cudzej kartoteki
-- (migracje 20261012140000_event_register_core i 20261012140100_event_register_entry, B1a).
--
-- DEFEKT (cialo `event_register` z 20261007140400:503-552).
--   * REG-01: konto wolajacego wiazalo sie z osoba o adresie z LADUNKU
--     (`user_id = COALESCE(p.user_id, v_bind_uid)`) bez potwierdzonego adresu
--     konta - kazde konto przejmowalo kartoteke, panel uczestnika i rezygnacje
--     osoby, ktorej adres wpisalo w formularz;
--   * REG-02: kazdy, takze anonim, nadpisywal imie, nazwisko i telefon
--     istniejacej osoby, stawial jej zgody marketingu i partnerow i zerowal
--     `consent_withdrawn_at`; adres IP i przegladarka dowodu szly z ladunku,
--     a most CRM (przypiecie atrybucji kluczem z odpowiedzi) zamienial
--     sfalszowany stempel w zgode kontaktu.
--
-- KRYTERIA AKCEPTACJI Z AUDYTU (nazwy asercji, doslownie):
--   REG-01 „konto X zapisuje adres Y -> user_id osoby Y zostaje NULL";
--   REG-02 „anonimowy zapis istniejacego adresu nie zmienia consent_* ani nazwiska".
--
-- SCIEZKA PRODUKCYJNA: funkcja serwerowa woluje `event_register_for_client`
-- kluczem serwisowym (najemca z hosta, konto z sesji, solony skrot adresu).
-- now() jest staly w transakcji.
BEGIN;
SELECT plan(21);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b1c0a000-0000-0000-0000-0000000000aa', 'idi-a', 'Identity Integrity A', 'idi-a.example');

-- X, Y, O, W: adres potwierdzony; U: bez potwierdzenia.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b1c00000-0000-0000-0000-0000000000a1', 'x@idi.example', now()),
  ('b1c00000-0000-0000-0000-0000000000a2', 'y@idi.example', now()),
  ('b1c00000-0000-0000-0000-0000000000a3', 'unconf@idi.example', NULL),
  ('b1c00000-0000-0000-0000-0000000000a4', 'owner@idi.example', now()),
  ('b1c00000-0000-0000-0000-0000000000a5', 'w@idi.example', now());
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('b1c00000-0000-0000-0000-0000000000a1', 'x@idi.example', 'IDI X', 'b1c0a000-0000-0000-0000-0000000000aa'),
  ('b1c00000-0000-0000-0000-0000000000a2', 'y@idi.example', 'IDI Y', 'b1c0a000-0000-0000-0000-0000000000aa'),
  ('b1c00000-0000-0000-0000-0000000000a3', 'unconf@idi.example', 'IDI U', 'b1c0a000-0000-0000-0000-0000000000aa'),
  ('b1c00000-0000-0000-0000-0000000000a4', 'owner@idi.example', 'IDI O', 'b1c0a000-0000-0000-0000-0000000000aa'),
  ('b1c00000-0000-0000-0000-0000000000a5', 'w@idi.example', 'IDI W', 'b1c0a000-0000-0000-0000-0000000000aa');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('b1c10000-0000-0000-0000-0000000000e1', 'b1c0a000-0000-0000-0000-0000000000aa',
   'idi-e1', 'IDI 1', 'IDI 1', now() + interval '30 days', 'published'),
  ('b1c10000-0000-0000-0000-0000000000e2', 'b1c0a000-0000-0000-0000-0000000000aa',
   'idi-e2', 'IDI 2', 'IDI 2', now() + interval '30 days', 'published'),
  ('b1c10000-0000-0000-0000-0000000000e3', 'b1c0a000-0000-0000-0000-0000000000aa',
   'idi-e3', 'IDI 3', 'IDI 3', now() + interval '30 days', 'published'),
  ('b1c10000-0000-0000-0000-0000000000e4', 'b1c0a000-0000-0000-0000-0000000000aa',
   'idi-e4', 'IDI 4', 'IDI 4', now() + interval '30 days', 'published');

INSERT INTO public.event_terms (id, tenant_id, event_id, key, label_pl, label_en, body_pl, is_required, display) VALUES
  ('b1c40000-0000-0000-0000-0000000000a1', 'b1c0a000-0000-0000-0000-0000000000aa',
   'b1c10000-0000-0000-0000-0000000000e3', 'idi_reg', 'Regulamin IDI', 'IDI terms', 'Tresc regulaminu IDI.',
   true, 'registration');

-- P_Y: gosc sprzed kont (bez dowiazania). V: osoba z wycofanymi zgodami.
-- P_O: osoba dowiazana do konta O. P_W: osoba bez konta, wycofala zgody.
INSERT INTO public.event_people
  (id, tenant_id, user_id, email, first_name, last_name, phone, consent_data_processing_at,
   consent_marketing_at, consent_partner_sharing_at, consent_withdrawn_at) VALUES
  ('b1c50000-0000-0000-0000-0000000000b1', 'b1c0a000-0000-0000-0000-0000000000aa', NULL,
   'y@idi.example', 'Yvonne', 'Yellow', NULL, '2026-01-01 10:00+00', NULL, NULL, NULL),
  ('b1c50000-0000-0000-0000-0000000000b2', 'b1c0a000-0000-0000-0000-0000000000aa', NULL,
   'victim@idi.example', 'Anna', 'Nowak', '+48 600 000 001', '2026-01-01 10:00+00', NULL, NULL,
   '2026-02-01 10:00+00'),
  ('b1c50000-0000-0000-0000-0000000000b3', 'b1c0a000-0000-0000-0000-0000000000aa',
   'b1c00000-0000-0000-0000-0000000000a4', 'owner@idi.example', 'Ola', 'Owner', NULL,
   '2026-01-01 10:00+00', NULL, NULL, NULL),
  ('b1c50000-0000-0000-0000-0000000000b4', 'b1c0a000-0000-0000-0000-0000000000aa', NULL,
   'w@idi.example', 'Wiktor', 'Withdrawn', NULL, '2026-01-01 10:00+00', NULL, NULL,
   '2026-02-01 10:00+00');

-- Kontakt CRM ofiary - zgoda marketingowa zgaszona.
INSERT INTO public.crm_leads (tenant_id, email, email_norm, marketing_consent) VALUES
  ('b1c0a000-0000-0000-0000-0000000000aa', 'victim@idi.example', 'victim@idi.example', false);

-- Migawka CALEJ kartoteki ofiary (kazda kolumna, takze `updated_at`).
CREATE TEMP TABLE idi_victim AS
  SELECT to_jsonb(p) AS row FROM public.event_people p
   WHERE p.id = 'b1c50000-0000-0000-0000-0000000000b2';

CREATE FUNCTION pg_temp.idi(p_uid uuid, p_ip text, p_payload jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.event_register_for_client(
    'b1c0a000-0000-0000-0000-0000000000aa', p_uid, p_ip, 'pgtap/1.0', p_payload)
$$;
CREATE TEMP TABLE idi_r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON idi_r TO service_role, authenticated, anon;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO idi_r (k, v) VALUES
  -- X (potwierdzone x@) wpisuje adres Y.
  ('xy', pg_temp.idi('b1c00000-0000-0000-0000-0000000000a1', 'ip:' || repeat('a1', 16),
     jsonb_build_object('event_slug', 'idi-e1', 'email', 'Y@idi.example ',
       'first_name', 'Mallory', 'last_name', 'Iks', 'consent_data_processing', true))),
  -- X wpisuje nowy, cudzy adres.
  ('xz', pg_temp.idi('b1c00000-0000-0000-0000-0000000000a1', 'ip:' || repeat('a1', 16),
     jsonb_build_object('event_slug', 'idi-e1', 'email', 'z@idi.example',
       'first_name', 'Zenon', 'last_name', 'Zet', 'consent_data_processing', true))),
  -- U zapisuje wlasny, ale NIEPOTWIERDZONY adres.
  ('uu', pg_temp.idi('b1c00000-0000-0000-0000-0000000000a3', 'ip:' || repeat('a2', 16),
     jsonb_build_object('event_slug', 'idi-e1', 'email', 'unconf@idi.example',
       'first_name', 'Urszula', 'last_name', 'Unconf', 'consent_data_processing', true)));
-- Anonim wpisuje adres ofiary (inna wielkosc liter i spacja): inne nazwisko,
-- wszystkie zgody, sfalszowany dowod adresu i przegladarki w ladunku.
INSERT INTO idi_r (k, v) VALUES
  ('anon', pg_temp.idi(NULL, 'ip:' || repeat('a5', 16),
     jsonb_build_object('event_slug', 'idi-e3', 'email', 'VICTIM@Idi.example ',
       'first_name', 'Mallory', 'last_name', 'Attacker', 'phone', '+48 999 999 999',
       'company_text', 'Evil Corp', 'consent_data_processing', true, 'consent_marketing', true,
       'consent_partner_sharing', true, 'ip_hash', 'deadbeefdeadbeef', 'user_agent', 'forged',
       'accepted_term_ids', jsonb_build_array('b1c40000-0000-0000-0000-0000000000a1')))),
  -- Wlasciciel O (dowiazany, bez wycofania) poprawia swoje dane i zaznacza marketing.
  ('own', pg_temp.idi('b1c00000-0000-0000-0000-0000000000a4', 'ip:' || repeat('a6', 16),
     jsonb_build_object('event_slug', 'idi-e1', 'email', 'owner@idi.example',
       'first_name', 'Ola', 'last_name', 'Owner-Nowak', 'phone', '+48 500 500 500',
       'consent_data_processing', true, 'consent_marketing', true))),
  -- W (potwierdzony adres osoby bez konta, wycofane zgody) zaznacza marketing.
  ('wd', pg_temp.idi('b1c00000-0000-0000-0000-0000000000a5', 'ip:' || repeat('a7', 16),
     jsonb_build_object('event_slug', 'idi-e1', 'email', 'w@idi.example',
       'first_name', 'Wiktor', 'last_name', 'Withdrawn-Nowy',
       'consent_data_processing', true, 'consent_marketing', true)));
RESET ROLE;

-- ── 1-8. REG-01: wiazanie konta tylko przez potwierdzony adres ──────────────
SELECT is(
  (SELECT user_id FROM public.event_people WHERE id = 'b1c50000-0000-0000-0000-0000000000b1'),
  NULL,
  'konto X zapisuje adres Y -> user_id osoby Y zostaje NULL');
SELECT ok(
  (SELECT v->'client' = '{"ok": true, "outcome": "check_email"}'::jsonb FROM idi_r WHERE k = 'xy')
  AND (SELECT first_name || ' ' || last_name FROM public.event_people
        WHERE id = 'b1c50000-0000-0000-0000-0000000000b1') = 'Yvonne Yellow'
  AND (SELECT r.submitted_profile->>'first_name' || ' ' || (r.submitted_profile->>'last_name')
         FROM public.event_registrations r
        WHERE r.id = (SELECT (v->'delivery'->>'registration_id')::uuid FROM idi_r WHERE k = 'xy')) = 'Mallory Iks'
  AND (SELECT v->'delivery'->'recipient'->>'first_name' FROM idi_r WHERE k = 'xy') = 'Yvonne',
  'konto X: odpowiedz neutralna, kartoteka Y nietknieta, dane X w submitted_profile, wiadomosc do Y');

SELECT set_config('request.headers', '{"x-tenant-host":"idi-a.example"}', true);
SELECT set_config('request.jwt.claim.sub', 'b1c00000-0000-0000-0000-0000000000a1', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"b1c00000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.event_my_registrations('{}'::jsonb)->'registrations') x
     WHERE x->>'registration_id' = (SELECT v->'delivery'->>'registration_id' FROM idi_r WHERE k = 'xy')),
  'konto X nie widzi zgloszenia osoby Y w event_my_registrations');
RESET ROLE;

SELECT ok(
  (SELECT user_id IS NULL AND created_by = 'b1c00000-0000-0000-0000-0000000000a1'
     FROM public.event_people
    WHERE tenant_id = 'b1c0a000-0000-0000-0000-0000000000aa' AND email_norm = 'z@idi.example'),
  'konto X zapisuje nowy cudzy adres: osoba bez dowiazania (created_by = X)');
SELECT ok(
  (SELECT v->'client' = '{"ok": true, "outcome": "check_email"}'::jsonb FROM idi_r WHERE k = 'uu')
  AND (SELECT user_id IS NULL FROM public.event_people
        WHERE tenant_id = 'b1c0a000-0000-0000-0000-0000000000aa' AND email_norm = 'unconf@idi.example'),
  'konto z niepotwierdzonym adresem: bez dowiazania i bez poswiadczen');
-- Dopiero teraz wlasciciel adresu Y (potwierdzone y@) zapisuje sie sam.
SET LOCAL ROLE service_role;
-- Y (potwierdzone y@) zapisuje sie sam.
INSERT INTO idi_r (k, v) VALUES
  ('yy', pg_temp.idi('b1c00000-0000-0000-0000-0000000000a2', 'ip:' || repeat('a3', 16),
     jsonb_build_object('event_slug', 'idi-e2', 'email', 'y@idi.example',
       'first_name', 'Yvonne', 'last_name', 'Yellow', 'consent_data_processing', true)));
RESET ROLE;
SELECT ok(
  (SELECT user_id FROM public.event_people WHERE id = 'b1c50000-0000-0000-0000-0000000000b1')
    = 'b1c00000-0000-0000-0000-0000000000a2'
  AND (SELECT v->'client'->>'outcome' = 'registered' AND (v->'client'->>'account_linked')::boolean
         FROM idi_r WHERE k = 'yy'),
  'Y z potwierdzonym adresem: osoba dowiazana do konta Y (sciezka prawowita zostaje)');

SELECT set_config('request.jwt.claim.sub', 'b1c00000-0000-0000-0000-0000000000a2', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"b1c00000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements(public.event_my_registrations('{}'::jsonb)->'registrations')),
  2,
  'Y widzi oba zgloszenia swojej osoby (takze to zalozone przez X)');
RESET ROLE;
-- Rezygnacja po `registration_id` wymaga, zeby osoba zgloszenia byla
-- dowiazana do wolajacego. Sprawdzamy ja PO zapisie Y: osoba ma wtedy
-- prawowitego wlasciciela, a X - dawniej dowiazany pierwszym zapisem, ktorego
-- `COALESCE(p.user_id, ...)` juz by nie oddal - nie ma do niej zadnego prawa.
-- (Osoba BEZ konta tez nie daje prawa rezygnacji: cialo
-- `event_registration_cancel` z 20261012170100 wymaga `v_uid IS NOT NULL AND
-- person_user_id IS NOT DISTINCT FROM v_uid`, wiec NULL po stronie osoby to
-- `forbidden`, a nie przepustka.)
SELECT set_config('request.jwt.claim.sub', 'b1c00000-0000-0000-0000-0000000000a1', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"b1c00000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_like(
  format($$SELECT public.event_registration_cancel(jsonb_build_object('registration_id', %L))$$,
    (SELECT v->'delivery'->>'registration_id' FROM idi_r WHERE k = 'xy')),
  'forbidden%',
  'konto X nie anuluje zgloszenia zalozonego na adres Y (forbidden)');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ── 9-16. REG-02: anonim na istniejacy adres ────────────────────────────────
SELECT is(
  (SELECT to_jsonb(p) FROM public.event_people p WHERE p.id = 'b1c50000-0000-0000-0000-0000000000b2'),
  (SELECT row FROM idi_victim),
  'anonimowy zapis istniejacego adresu nie zmienia consent_* ani nazwiska');
SELECT ok(
  (SELECT v->'client' = '{"ok": true, "outcome": "check_email"}'::jsonb FROM idi_r WHERE k = 'anon')
  AND (SELECT r.submitted_profile = jsonb_build_object(
                'first_name', 'Mallory', 'last_name', 'Attacker', 'phone', '+48 999 999 999',
                'company_text', 'Evil Corp')
         FROM public.event_registrations r
        WHERE r.id = (SELECT (v->'delivery'->>'registration_id')::uuid FROM idi_r WHERE k = 'anon')),
  'dane anonima trafiaja do submitted_profile zgloszenia (do wgladu organizatora)');
SELECT is(
  ARRAY(SELECT c.purpose || ':' || c.status || ':' || c.evidence
          FROM public.event_consent_records c
         WHERE c.registration_id = (SELECT (v->'delivery'->>'registration_id')::uuid FROM idi_r WHERE k = 'anon')
         ORDER BY c.purpose, c.status),
  ARRAY['data_processing:confirmed:registration_form', 'marketing:pending:registration_form',
        'partner_sharing:pending:registration_form'],
  'ksiega: marketing i partnerzy tylko pending (DOI), przetwarzanie danych bez projekcji');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_consent_records c
               WHERE c.person_id = 'b1c50000-0000-0000-0000-0000000000b2'
                 AND (c.ip_subject IS DISTINCT FROM 'ip:' || repeat('a5', 16)
                      OR c.user_agent IS DISTINCT FROM 'pgtap/1.0'))
  AND (SELECT ip_hash = repeat('a5', 16) AND user_agent = 'pgtap/1.0'
         FROM public.event_term_acceptances
        WHERE registration_id = (SELECT (v->'delivery'->>'registration_id')::uuid FROM idi_r WHERE k = 'anon')),
  'dowod adresu i przegladarki z serwera (ksiega i akceptacja regulaminu)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_term_acceptances
               WHERE ip_hash LIKE '%deadbeef%' OR user_agent = 'forged')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE ip_subject LIKE '%deadbeef%' OR user_agent = 'forged')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_confirmations
                   WHERE requested_ip_subject LIKE '%deadbeef%' OR requested_user_agent = 'forged'),
  'ip_hash i user_agent z ladunku sa ignorowane');
SELECT ok(
  (SELECT v->'delivery'->'consent_confirmation'->>'token' ~ '^[A-Za-z0-9_-]{32}$'
          AND v->'delivery'->'consent_confirmation'->'purposes' = '["marketing", "partner_sharing"]'::jsonb
          AND NOT (v->'client' ? 'consent_confirmation')
     FROM idi_r WHERE k = 'anon')
  AND EXISTS (SELECT 1 FROM public.event_consent_confirmations c
               WHERE c.person_id = 'b1c50000-0000-0000-0000-0000000000b2'
                 AND c.token_hash = encode(extensions.digest(
                       (SELECT v->'delivery'->'consent_confirmation'->>'token' FROM idi_r WHERE k = 'anon'),
                       'sha256'), 'hex')),
  'dostawa niesie link double opt-in na adres ofiary (tylko dla serwera, nie dla przegladarki)');
SELECT ok(
  (SELECT v->'delivery'->'recipient'->>'first_name' = 'Anna'
          AND v->'delivery'->'recipient'->>'email' = 'victim@idi.example'
     FROM idi_r WHERE k = 'anon'),
  'odbiorca wiadomosci z kartoteki (prawdziwy wlasciciel adresu), nie z ladunku');

-- Przypiecie atrybucji kluczem z dostawy (dawniej: z odpowiedzi w przegladarce)
-- uruchamia most CRM. Bez zgody z kanalu zweryfikowanego kontakt zgody nie dostaje.
SELECT set_config('request.headers', '{"x-tenant-host":"idi-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT public.event_registration_attribution_attach(jsonb_build_object(
  'manage_token', (SELECT v->'delivery'->>'manage_token' FROM idi_r WHERE k = 'anon')));
RESET ROLE;
SELECT ok(
  NOT (SELECT marketing_consent FROM public.crm_leads
        WHERE tenant_id = 'b1c0a000-0000-0000-0000-0000000000aa' AND email_norm = 'victim@idi.example')
  AND NOT EXISTS (SELECT 1 FROM public.crm_consent_log
                   WHERE tenant_id = 'b1c0a000-0000-0000-0000-0000000000aa'
                     AND lower(email) = 'victim@idi.example' AND given),
  'przypiecie atrybucji po zapisie anonima nie daje zgody marketingowej w CRM');

-- ── 17-19. Zweryfikowany wlasciciel ─────────────────────────────────────────
SELECT ok(
  (SELECT last_name = 'Owner-Nowak' AND phone = '+48 500 500 500' AND consent_marketing_at IS NOT NULL
          AND consent_withdrawn_at IS NULL
     FROM public.event_people WHERE id = 'b1c50000-0000-0000-0000-0000000000b3')
  AND EXISTS (SELECT 1 FROM public.event_consent_records c
               WHERE c.person_id = 'b1c50000-0000-0000-0000-0000000000b3'
                 AND c.purpose = 'marketing' AND c.status = 'confirmed' AND c.evidence = 'verified_account')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_confirmations c
                   WHERE c.person_id = 'b1c50000-0000-0000-0000-0000000000b3')
  AND (SELECT v->'client'->>'outcome' = 'registered'
              AND NOT (v->'client'->>'consent_confirmation_required')::boolean
              AND v->'delivery'->'consent_confirmation' = 'null'::jsonb
         FROM idi_r WHERE k = 'own'),
  'zweryfikowany wlasciciel: poprawia swoje dane i udziela zgody kanalem konta (verified_account)');
SELECT ok(
  (SELECT last_name = 'Withdrawn-Nowy' AND user_id = 'b1c00000-0000-0000-0000-0000000000a5'
          AND consent_marketing_at IS NULL AND consent_withdrawn_at = '2026-02-01 10:00+00'
     FROM public.event_people WHERE id = 'b1c50000-0000-0000-0000-0000000000b4')
  AND EXISTS (SELECT 1 FROM public.event_consent_records c
               WHERE c.person_id = 'b1c50000-0000-0000-0000-0000000000b4'
                 AND c.purpose = 'marketing' AND c.status = 'pending')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records c
                   WHERE c.person_id = 'b1c50000-0000-0000-0000-0000000000b4'
                     AND c.purpose = 'marketing' AND c.status = 'confirmed')
  AND (SELECT (v->'client'->>'consent_confirmation_required')::boolean
              AND v->'delivery'->'consent_confirmation'->>'token' IS NOT NULL
         FROM idi_r WHERE k = 'wd'),
  'zweryfikowany wlasciciel po wycofaniu: dane i dowiazanie tak, zgoda tylko przez link z maila');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_people
               WHERE tenant_id = 'b1c0a000-0000-0000-0000-0000000000aa'
                 AND consent_withdrawn_at IS NULL
                 AND id IN ('b1c50000-0000-0000-0000-0000000000b2', 'b1c50000-0000-0000-0000-0000000000b4')),
  'zaden zapis nie zeruje consent_withdrawn_at');

-- ── 20-21. Wrapper zgodnosci (bez adresu i bez linku zgody) ────────────────
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
INSERT INTO idi_r (k, v) VALUES
  ('legacy', public.event_register(jsonb_build_object(
     'event_slug', 'idi-e4', 'email', 'victim@idi.example',
     'first_name', 'Mallory', 'last_name', 'Legacy', 'consent_data_processing', true,
     'consent_marketing', true)));
SELECT is(
  (SELECT to_jsonb(p) FROM public.event_people p WHERE p.id = 'b1c50000-0000-0000-0000-0000000000b2'),
  (SELECT row FROM idi_victim),
  'wrapper zgodnosci: anonimowy zapis istniejacego adresu tez nie zmienia kartoteki');
SELECT ok(
  (SELECT NOT (v ? 'consent_confirmation') AND NOT (v ? 'recipient') AND NOT (v ? 'verified')
          AND v->>'registration_id' IS NOT NULL
     FROM idi_r WHERE k = 'legacy'),
  'wrapper zgodnosci: dawny ksztalt odpowiedzi, bez linku zgody i bez danych odbiorcy');

SELECT set_config('request.headers', '', true);
SELECT * FROM finish();
ROLLBACK;
