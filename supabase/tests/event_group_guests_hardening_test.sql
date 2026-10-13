-- pgTAP: dopisanie gosci do zgloszenia prowadzacego (REG-08, REG-07, REG-04,
-- REG-13, REG-16, REG-14/REG-02). Migracje
-- 20261012150100_event_group_guests_hardening.sql (cialo koncowe B6)
-- i 20261012180300_event_group_guests_validation_first.sql (przeglad R38:
-- rdzen `_event_register_group_guests`, wejscie serwerowe
-- `event_register_group_guests_for_client`, wrapper zgodnosci tylko dla
-- service_role).
--
-- KRYTERIA:
--   * REG-04 (R38): CALA lista walidowana PRZED odczytem czlonkostwa - lista
--     [gosc zapisany, zly wiersz] i [gosc swiezy, zly wiersz] dostaja te sama
--     odmowe; gosc z aktywnym zapisem jest POMIJANY bez sladu w odpowiedzi
--     (`added` = liczba poprawnych gosci, bez `detail`, bez `registration_ids`),
--     a jego adres idzie WYLACZNIE kanalem serwerowym (`delivery`) do
--     wiadomosci `event_registration_already_registered`; duplikat w liscie
--     i adres prowadzacego to `duplicate_guest`; znaki sterujace odrzucone.
--   * REG-04: kubelek ADRESU `event_register.ip` (120 / 10 min, wspolny
--     z zapisem) i konta `event_register.guests` (12 / 10 min) liczone PRZED
--     praca - odmowa nie cofa licznika, 13. proba to `rate_limited` bez
--     zapisow; surowy adres to blad serwera.
--   * REG-13: wydarzenie zakonczone -> `event_ended`.
--   * REG-16: goscie dostaja oferte ceny prowadzacego (trzy kolumny razem).
--   * REG-14/REG-02: nowa osoba goscia `source = 'invitation'`, bez kolumn
--     zgod i bez wpisow w ksiedze zgod; istniejaca osoba nietknieta.
--   * REG-07: prowadzacy przyjety bez wplaty albo w kolejce -> goscie `pending`
--     bez kodu QR i bez miejsca; prowadzacy na miejscu z biletem bezplatnym ->
--     goscie przyjeci z kodem i sladem decyzji.
--   * REG-08: blokada wydarzenia przed zgloszeniem (statycznie; wyscig dwoch
--     sesji - harness 29_waitlist_settlement_group_locks.sql).
--
-- SCIEZKA PRODUKCYJNA: funkcja serwerowa `registerEventGroupGuests` woluje
-- `event_register_group_guests_for_client` kluczem serwisowym - tu tak samo
-- (service_role). Wrapper zgodnosci wolany jako wlasciciel bazy z JWT
-- prowadzacego (tak jak harness), bo klienci nie maja juz do niego grantu.
BEGIN;
SELECT plan(40);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b6ba0000-0000-0000-0000-0000000000aa', 'b6gg-a', 'B6 Goscie A', 'b6gg-a.example');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b6b00000-0000-0000-0000-0000000000c1', 'b6gg-lead@example.org', now()),
  ('b6b00000-0000-0000-0000-0000000000c2', 'b6gg-other@example.org', now());
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('b6b00000-0000-0000-0000-0000000000c1', 'b6gg-lead@example.org', 'Prowadzaca', 'b6ba0000-0000-0000-0000-0000000000aa'),
  ('b6b00000-0000-0000-0000-0000000000c2', 'b6gg-other@example.org', 'Obcy', 'b6ba0000-0000-0000-0000-0000000000aa');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
                           registration_mode, registration_flow) VALUES
  ('b6b10000-0000-0000-0000-000000000001', 'b6ba0000-0000-0000-0000-0000000000aa', 'b6gg-live',
   'B6 goscie', 'B6 guests', now() + interval '20 days', NULL, 'published', 'form', 'instant'),
  ('b6b10000-0000-0000-0000-000000000002', 'b6ba0000-0000-0000-0000-0000000000aa', 'b6gg-ended',
   'B6 po koncu', 'B6 ended', now() - interval '3 days', now() - interval '2 days', 'published', 'form', 'instant'),
  ('b6b10000-0000-0000-0000-000000000003', 'b6ba0000-0000-0000-0000-0000000000aa', 'b6gg-free',
   'B6 bezplatne', 'B6 free', now() + interval '20 days', NULL, 'published', 'form', 'instant');

INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
                                       quota, group_registration_enabled, group_max_size) VALUES
  ('b6b20000-0000-0000-0000-000000000001', 'b6ba0000-0000-0000-0000-0000000000aa',
   'b6b10000-0000-0000-0000-000000000001', 'b6gg_paid', 'Platny', 'Paid', 10000, 'PLN', 20, true, 10),
  ('b6b20000-0000-0000-0000-000000000002', 'b6ba0000-0000-0000-0000-0000000000aa',
   'b6b10000-0000-0000-0000-000000000002', 'b6gg_ended', 'Po koncu', 'Ended', 0, 'PLN', NULL, true, 10),
  ('b6b20000-0000-0000-0000-000000000003', 'b6ba0000-0000-0000-0000-0000000000aa',
   'b6b10000-0000-0000-0000-000000000003', 'b6gg_free', 'Bezplatny', 'Free', 0, 'PLN', 20, true, 10);

-- Prowadzaca (osoba z kontem), osoba ISTNIEJACA w kartotece (bez konta), ktora
-- prowadzaca wpisze jako goscia: jej dane i zgody nie moga sie zmienic, i osoba
-- ZAPISANA juz na b6gg-live (cel sondy czlonkostwa).
INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, source,
                                 consent_data_processing_at, consent_marketing_at, consent_withdrawn_at) VALUES
  ('b6b30000-0000-0000-0000-0000000000c1', 'b6ba0000-0000-0000-0000-0000000000aa',
   'b6b00000-0000-0000-0000-0000000000c1', 'b6gg-lead@example.org', 'Lena', 'Prowadzaca', 'self_registration',
   now(), NULL, NULL),
  ('b6b30000-0000-0000-0000-0000000000e1', 'b6ba0000-0000-0000-0000-0000000000aa',
   NULL, 'b6gg-existing@example.org', 'Ewa', 'Prawdziwa', 'organizer',
   now() - interval '1 year', NULL, now() - interval '1 month'),
  ('b6b30000-0000-0000-0000-0000000000f1', 'b6ba0000-0000-0000-0000-0000000000aa',
   NULL, 'b6gg-member@example.org', 'Maria', 'Zapisana', 'self_registration',
   now(), NULL, NULL);

-- L1: platny, przyjety przez organizatora PRZED wplata, z oferta ceny.
-- L2: zakonczone wydarzenie. L3: bezplatny, przyjety (system).
-- M1: zapis osoby b6gg-member na b6gg-live (bez zwiazku z prowadzaca).
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
   decided_at, decision_source, created_by, quoted_price_cents, quoted_currency, quote_valid_until,
   waitlist_position, lang) VALUES
  ('b6b40000-0000-0000-0000-000000000001', 'b6ba0000-0000-0000-0000-0000000000aa', 'b6b10000-0000-0000-0000-000000000001',
   'b6b30000-0000-0000-0000-0000000000c1', 'b6b20000-0000-0000-0000-000000000001', 'approved', 'form', 'unpaid',
   now(), 'organizer', 'b6b00000-0000-0000-0000-0000000000c1', 7500, 'PLN', now() + interval '72 hours', NULL, NULL),
  ('b6b40000-0000-0000-0000-000000000002', 'b6ba0000-0000-0000-0000-0000000000aa', 'b6b10000-0000-0000-0000-000000000002',
   'b6b30000-0000-0000-0000-0000000000c1', 'b6b20000-0000-0000-0000-000000000002', 'approved', 'form', 'not_required',
   now(), 'system', 'b6b00000-0000-0000-0000-0000000000c1', NULL, NULL, NULL, NULL, NULL),
  ('b6b40000-0000-0000-0000-000000000003', 'b6ba0000-0000-0000-0000-0000000000aa', 'b6b10000-0000-0000-0000-000000000003',
   'b6b30000-0000-0000-0000-0000000000c1', 'b6b20000-0000-0000-0000-000000000003', 'approved', 'form', 'not_required',
   now(), 'system', 'b6b00000-0000-0000-0000-0000000000c1', NULL, NULL, NULL, NULL, NULL),
  ('b6b40000-0000-0000-0000-0000000000f1', 'b6ba0000-0000-0000-0000-0000000000aa', 'b6b10000-0000-0000-0000-000000000001',
   'b6b30000-0000-0000-0000-0000000000f1', 'b6b20000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'en');

CREATE TEMP TABLE b6g_out (k text PRIMARY KEY, v jsonb);
GRANT ALL ON b6g_out TO authenticated, service_role;

-- Wywolanie serwera (jak groupGuests.server.ts): najemca z hosta, konto z sesji,
-- solony skrot adresu.
CREATE FUNCTION pg_temp.gg(p_uid uuid, p_ip_seed text, p_lead uuid, p_guests jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.event_register_group_guests_for_client(
    'b6ba0000-0000-0000-0000-0000000000aa', p_uid, 'ip:' || md5(p_ip_seed), p_lead, p_guests)
$$;
-- Wrapper zgodnosci jako wlasciciel bazy z JWT prowadzacej (droga harnessu).
CREATE FUNCTION pg_temp.gg_legacy(p_uid uuid, p_lead uuid, p_guests jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.headers', '{"x-tenant-host":"b6gg-a.example"}', true);
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  v := public.event_register_group_guests(p_lead, p_guests);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  RETURN v;
END $$;

-- ── 1-4. Uprawnienia, kolejnosc blokad ───────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.event_register_group_guests(uuid,jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.event_register_group_guests(uuid,jsonb)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.event_register_group_guests(uuid,jsonb)', 'EXECUTE'),
  'R38: wrapper zgodnosci tylko dla service_role (przegladarka nie dopisuje z pominieciem kubelka adresu)');
SELECT ok(NOT has_function_privilege('anon', 'public.event_register_group_guests_for_client(uuid,uuid,text,uuid,jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.event_register_group_guests_for_client(uuid,uuid,text,uuid,jsonb)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.event_register_group_guests_for_client(uuid,uuid,text,uuid,jsonb)', 'EXECUTE'),
  'R38: wejscie serwerowe event_register_group_guests_for_client wylacznie dla service_role');
SELECT ok(NOT has_function_privilege('anon', 'public._event_register_group_guests(uuid,uuid,uuid,jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_register_group_guests(uuid,uuid,uuid,jsonb)', 'EXECUTE'),
  'R38: rdzen _event_register_group_guests bez grantu dla klientow');
SELECT ok(
  (SELECT strpos(p.prosrc, 'FROM public.events e') > 0
      AND strpos(p.prosrc, 'FROM public.events e') < strpos(p.prosrc, 'FROM public.event_ticket_types t')
      AND strpos(p.prosrc, 'FROM public.event_ticket_types t') < strpos(p.prosrc, 'FOR UPDATE OF r')
     FROM pg_proc p WHERE p.oid = 'public._event_register_group_guests(uuid,uuid,uuid,jsonb)'::regprocedure),
  'REG-08: blokady wydarzenie -> bilet -> zgloszenie prowadzacego');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;

-- ── 5-11. REG-07 + REG-16 + REG-14: prowadzaca przyjeta bez wplaty ───────────
INSERT INTO b6g_out SELECT 'unpaid_lead', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'lead-1',
  'b6b40000-0000-0000-0000-000000000001',
  '[{"first_name":"Nowy","last_name":"Gosc","email":"b6gg-new@example.org"},
    {"first_name":"Podszyty","last_name":"Ktos","email":"B6GG-EXISTING@example.org"}]'::jsonb);
RESET ROLE;

SELECT is((SELECT v FROM b6g_out WHERE k = 'unpaid_lead'),
  '{"client": {"ok": true, "added": 2}, "delivery": []}'::jsonb,
  'sukces: {ok:true, added} bez registration_ids; nikogo nie pominieto - pusta dostawa');
SELECT ok(
  (SELECT count(*) = 2 AND bool_and(r.status = 'pending' AND r.payment_status = 'unpaid' AND r.qr_token_hash IS NULL
                   AND r.decided_at IS NULL AND r.decision_source IS NULL)
     FROM public.event_registrations r
    WHERE r.group_lead_registration_id = 'b6b40000-0000-0000-0000-000000000001'),
  'REG-07: prowadzaca przyjeta bez wplaty - goscie pending, bez kodu QR i bez sladu cudzej decyzji');
SELECT is((SELECT sold_count FROM public.event_ticket_types WHERE id = 'b6b20000-0000-0000-0000-000000000001'),
  1, 'REG-07: nieoplaceni goscie nie zajmuja miejsc w puli (tylko prowadzaca)');
SELECT ok(
  (SELECT bool_and(r.quoted_price_cents = 7500 AND r.quoted_currency = 'PLN'
                   AND r.quote_valid_until = l.quote_valid_until)
     FROM public.event_registrations r
     JOIN public.event_registrations l ON l.id = r.group_lead_registration_id
    WHERE r.group_lead_registration_id = 'b6b40000-0000-0000-0000-000000000001'),
  'REG-16: goscie dostaja oferte ceny prowadzacej (kwota, waluta, termin razem)');
SELECT ok(
  (SELECT p.source = 'invitation' AND p.created_by = 'b6b00000-0000-0000-0000-0000000000c1'
      AND p.consent_data_processing_at IS NULL AND p.consent_marketing_at IS NULL
      AND p.consent_partner_sharing_at IS NULL AND p.consent_withdrawn_at IS NULL
      AND p.user_id IS NULL AND p.first_name = 'Nowy'
     FROM public.event_people p
    WHERE p.tenant_id = 'b6ba0000-0000-0000-0000-0000000000aa' AND p.email_norm = 'b6gg-new@example.org'),
  'REG-14: nowa osoba goscia - pochodzenie invitation, zadnej kolumny zgody, bez konta');
SELECT is(
  (SELECT count(*)::int FROM public.event_consent_records c
    WHERE c.tenant_id = 'b6ba0000-0000-0000-0000-0000000000aa'
      AND c.email_norm IN ('b6gg-new@example.org', 'b6gg-existing@example.org')),
  0, 'REG-14: dopisanie gosci nie zapisuje nic w ksiedze zgod');
SELECT ok(
  (SELECT p.first_name = 'Ewa' AND p.last_name = 'Prawdziwa' AND p.source = 'organizer'
      AND p.consent_data_processing_at < now() - interval '11 months'
      AND p.consent_marketing_at IS NULL
      AND p.consent_withdrawn_at IS NOT NULL AND p.user_id IS NULL
     FROM public.event_people p WHERE p.id = 'b6b30000-0000-0000-0000-0000000000e1')
  AND EXISTS (SELECT 1 FROM public.event_registrations r
               WHERE r.person_id = 'b6b30000-0000-0000-0000-0000000000e1'
                 AND r.group_lead_registration_id = 'b6b40000-0000-0000-0000-000000000001'),
  'REG-02: istniejaca osoba dopisana jako gosc - jej dane, zgody, wycofanie i konto nietkniete');

-- ── 12-15. REG-04 (R38): gosc juz zapisany pominiety bez sladu ───────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO b6g_out SELECT 'skip', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'lead-1',
  'b6b40000-0000-0000-0000-000000000001',
  '[{"first_name":"Ktos","last_name":"Inny","email":"b6gg-member@example.org"},
    {"first_name":"Swiezy","last_name":"Gosc","email":"b6gg-fresh@example.org"}]'::jsonb);
INSERT INTO b6g_out SELECT 'all_fresh', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'lead-1',
  'b6b40000-0000-0000-0000-000000000001',
  '[{"first_name":"Ktos","last_name":"Inny","email":"b6gg-nobody1@example.org"},
    {"first_name":"Swiezy","last_name":"Gosc","email":"b6gg-nobody2@example.org"}]'::jsonb);
RESET ROLE;

SELECT is((SELECT v->'client' FROM b6g_out WHERE k = 'skip'), '{"ok": true, "added": 2}'::jsonb,
  'REG-04: gosc z aktywnym zapisem pominiety i liczony jako przyjety - added = liczba poprawnych gosci, bez detail');
SELECT ok(
  (SELECT count(*) = 1 FROM public.event_registrations r
    WHERE r.person_id = 'b6b30000-0000-0000-0000-0000000000f1'
      AND r.event_id = 'b6b10000-0000-0000-0000-000000000001')
  AND EXISTS (SELECT 1 FROM public.event_registrations r JOIN public.event_people p ON p.id = r.person_id
               WHERE p.email_norm = 'b6gg-fresh@example.org'
                 AND r.group_lead_registration_id = 'b6b40000-0000-0000-0000-000000000001')
  AND (SELECT p.first_name = 'Maria' FROM public.event_people p WHERE p.id = 'b6b30000-0000-0000-0000-0000000000f1'),
  'REG-04: pominiety gosc bez nowego wiersza i nietkniety; swiezy gosc z tej samej listy dopisany');
SELECT is((SELECT v->'delivery' FROM b6g_out WHERE k = 'skip'),
  jsonb_build_array(jsonb_build_object(
    'kind', 'already_registered',
    'registration_id', 'b6b40000-0000-0000-0000-0000000000f1',
    'status', 'pending',
    'recipient', jsonb_build_object('email', 'b6gg-member@example.org', 'first_name', 'Maria', 'lang', 'en'),
    'event', jsonb_build_object('id', 'b6b10000-0000-0000-0000-000000000001', 'slug', 'b6gg-live',
                                'title_pl', 'B6 goscie', 'title_en', 'B6 guests',
                                'starts_at', (SELECT starts_at FROM public.events WHERE id = 'b6b10000-0000-0000-0000-000000000001')),
    'consent_confirmation', NULL)),
  'REG-04: adres pominietego WYLACZNIE w kanale serwerowym - wiadomosc „juz zapisany" do wlasciciela (dane z kartoteki, jego jezyk)');
SELECT is((SELECT v->'client' FROM b6g_out WHERE k = 'all_fresh'), (SELECT v->'client' FROM b6g_out WHERE k = 'skip'),
  'REG-04 „odpowiedzi nierozroznialne": lista z gosciem zapisanym i lista samych swiezych - ta sama odpowiedz');

-- ── 16-19. REG-04 (R38): walidacja CALEJ listy przed odczytem czlonkostwa ────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO b6g_out SELECT 'probe_member', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'probe-1',
  'b6b40000-0000-0000-0000-000000000001',
  '[{"first_name":"Sonda","last_name":"Jeden","email":"b6gg-member@example.org"},
    {"first_name":"","last_name":"","email":"x@example.org"}]'::jsonb);
INSERT INTO b6g_out SELECT 'probe_fresh', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'probe-1',
  'b6b40000-0000-0000-0000-000000000001',
  '[{"first_name":"Sonda","last_name":"Dwa","email":"b6gg-never@example.org"},
    {"first_name":"","last_name":"","email":"x@example.org"}]'::jsonb);
RESET ROLE;
-- Ta sama sonda przez wrapper zgodnosci (droga, ktora istniala przed R38).
INSERT INTO b6g_out SELECT 'probe_member_legacy', pg_temp.gg_legacy('b6b00000-0000-0000-0000-0000000000c1',
  'b6b40000-0000-0000-0000-000000000001',
  '[{"first_name":"Sonda","last_name":"Jeden","email":"b6gg-member@example.org"},
    {"first_name":"","last_name":"","email":"x@example.org"}]'::jsonb);

SELECT ok(
  (SELECT v FROM b6g_out WHERE k = 'probe_member') = (SELECT v FROM b6g_out WHERE k = 'probe_fresh')
  AND (SELECT v FROM b6g_out WHERE k = 'probe_member')
      = '{"client": {"ok": false, "error": "invalid_name"}, "delivery": []}'::jsonb,
  'REG-04 (R38): [zapisany, zly wiersz] i [swiezy, zly wiersz] - ta sama odmowa invalid_name, bez adresu');
SELECT is((SELECT v FROM b6g_out WHERE k = 'probe_member_legacy'), '{"ok": false, "error": "invalid_name"}'::jsonb,
  'REG-04 (R38): wrapper zgodnosci - ta sama walidacja przed czlonkostwem (zadnego already_registered: <adres>)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_people p WHERE p.email_norm = 'b6gg-never@example.org'),
  'odmowa listy niczego nie zapisuje (swiezy adres nie trafia do kartoteki)');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO b6g_out SELECT 'dup', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'probe-1',
  'b6b40000-0000-0000-0000-000000000001',
  '[{"first_name":"Dwa","last_name":"Razy","email":"b6gg-dup@example.org"},
    {"first_name":"Dwa","last_name":"Razy","email":" B6GG-DUP@example.org "}]'::jsonb);
INSERT INTO b6g_out SELECT 'self', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'probe-1',
  'b6b40000-0000-0000-0000-000000000001',
  '[{"first_name":"Ja","last_name":"Sama","email":"b6gg-lead@example.org"}]'::jsonb);
INSERT INTO b6g_out SELECT 'ctrl', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'probe-1',
  'b6b40000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('first_name', 'Ja' || chr(1) || 'n', 'last_name', 'Kowalski',
                                       'email', 'b6gg-ctrl@example.org')));
RESET ROLE;
SELECT ok(
  (SELECT v->'client' FROM b6g_out WHERE k = 'dup') = '{"ok": false, "error": "duplicate_guest"}'::jsonb
  AND NOT EXISTS (SELECT 1 FROM public.event_people p WHERE p.email_norm = 'b6gg-dup@example.org'),
  'R38: duplikat w liscie - duplicate_guest przed jakimkolwiek zapisem (nie already_registered: <adres>)');

-- ── 20-21. Adres prowadzacej i znaki sterujace ────────────────────────────────
SELECT is((SELECT v->'client' FROM b6g_out WHERE k = 'self'), '{"ok": false, "error": "duplicate_guest"}'::jsonb,
  'R38: adres prowadzacej na liscie gosci - duplicate_guest');
SELECT ok(
  (SELECT v->'client' FROM b6g_out WHERE k = 'ctrl') = '{"ok": false, "error": "invalid_name"}'::jsonb
  AND NOT EXISTS (SELECT 1 FROM public.event_people p WHERE p.email_norm = 'b6gg-ctrl@example.org'),
  'R38: znak sterujacy w imieniu goscia - invalid_name (ta sama regula co zapis)');

-- ── 22-26. REG-04: kubelki adresu i konta liczone przed praca ────────────────
SELECT is(
  (SELECT rl.count FROM public.rate_limits rl
    WHERE rl.scope = 'event_register.guests' AND rl.subject_id = 'user:b6b00000-0000-0000-0000-0000000000c1'),
  9, 'REG-04: kubelek konta liczy kazda probe - sukcesy, odmowy i wrapper zgodnosci (odmowa nie cofa licznika)');
SELECT is(
  (SELECT rl.count FROM public.rate_limits rl
    WHERE rl.scope = 'event_register.ip' AND rl.subject_id = 'ip:' || md5('probe-1')),
  5, 'R38: kubelek ADRESU event_register.ip liczy kazda probe wejscia serwerowego (takze odmowy)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.rate_limits rl
               WHERE rl.scope = 'event_register.guests' AND rl.subject_id NOT LIKE 'user:%')
  AND NOT EXISTS (SELECT 1 FROM public.rate_limits rl
               WHERE rl.scope = 'event_register.ip' AND rl.subject_id !~ '^ip:[0-9a-f]{32}$'),
  'kubelki kluczowane wylacznie kontem (user:<uuid>) i solonym skrotem adresu, nigdy adresem z ladunku');

-- Adres wspolny dla wielu kont: pelny kubelek adresu zatrzymuje KAZDE konto.
UPDATE public.rate_limits SET count = 120
 WHERE scope = 'event_register.ip' AND subject_id = 'ip:' || md5('probe-1');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO b6g_out SELECT 'ip_full', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c2', 'probe-1',
  'b6b40000-0000-0000-0000-000000000003',
  '[{"first_name":"Przez","last_name":"Nat","email":"b6gg-nat@example.org"}]'::jsonb);
RESET ROLE;
SELECT ok(
  (SELECT v->'client' FROM b6g_out WHERE k = 'ip_full') = '{"ok": false, "error": "rate_limited"}'::jsonb
  AND NOT EXISTS (SELECT 1 FROM public.event_people p WHERE p.email_norm = 'b6gg-nat@example.org'),
  'R38: kubelek adresu pelny (120 / 10 min) - inne konto z tego adresu dostaje rate_limited bez zapisow');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT throws_like(
  $$SELECT public.event_register_group_guests_for_client('b6ba0000-0000-0000-0000-0000000000aa',
      'b6b00000-0000-0000-0000-0000000000c1', '192.0.2.10', 'b6b40000-0000-0000-0000-000000000003', '[]'::jsonb)$$,
  'invalid_payload%', 'surowy adres IP to blad serwera, nie kubelek');
RESET ROLE;

-- ── 27. Kubelek konta: 13. proba w oknie ─────────────────────────────────────
-- Kolejne proby do limitu 12 (odmowy group_too_large nie sa tu istotne).
UPDATE public.rate_limits SET count = 11
 WHERE scope = 'event_register.guests' AND subject_id = 'user:b6b00000-0000-0000-0000-0000000000c1';
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO b6g_out SELECT 'twelfth', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'lead-1',
  'b6b40000-0000-0000-0000-000000000003',
  '[{"first_name":"Za","last_name":"Duzo","email":"b6gg-x1@example.org"},
    {"first_name":"Za","last_name":"Duzo","email":"b6gg-x2@example.org"},
    {"first_name":"Za","last_name":"Duzo","email":"b6gg-x3@example.org"},
    {"first_name":"Za","last_name":"Duzo","email":"b6gg-x4@example.org"},
    {"first_name":"Za","last_name":"Duzo","email":"b6gg-x5@example.org"},
    {"first_name":"Za","last_name":"Duzo","email":"b6gg-x6@example.org"},
    {"first_name":"Za","last_name":"Duzo","email":"b6gg-x7@example.org"},
    {"first_name":"Za","last_name":"Duzo","email":"b6gg-x8@example.org"},
    {"first_name":"Za","last_name":"Duzo","email":"b6gg-x9@example.org"},
    {"first_name":"Za","last_name":"Duzo","email":"b6gg-x10@example.org"}]'::jsonb);
INSERT INTO b6g_out SELECT 'thirteenth', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'lead-1',
  'b6b40000-0000-0000-0000-000000000003',
  '[{"first_name":"Trzynasty","last_name":"Gosc","email":"b6gg-13@example.org"}]'::jsonb);
RESET ROLE;
SELECT ok(
  (SELECT v->'client' = '{"ok": false, "error": "group_too_large"}'::jsonb FROM b6g_out WHERE k = 'twelfth')
  AND (SELECT v->'client' = '{"ok": false, "error": "rate_limited"}'::jsonb FROM b6g_out WHERE k = 'thirteenth')
  AND NOT EXISTS (SELECT 1 FROM public.event_people p WHERE p.email_norm = 'b6gg-13@example.org')
  AND NOT EXISTS (SELECT 1 FROM public.event_registrations r
                   WHERE r.group_lead_registration_id = 'b6b40000-0000-0000-0000-000000000003'),
  'REG-04: 12. proba (odmowa) liczona, 13. w oknie - rate_limited przed praca (zero zapisow)');

-- ── 28-34. Pozostale odmowy jako wartosci ────────────────────────────────────
UPDATE public.rate_limits SET count = 0
 WHERE scope = 'event_register.guests' AND subject_id = 'user:b6b00000-0000-0000-0000-0000000000c1';
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO b6g_out SELECT 'ended', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'lead-2',
  'b6b40000-0000-0000-0000-000000000002',
  '[{"first_name":"Po","last_name":"Czasie","email":"b6gg-late@example.org"}]'::jsonb);
INSERT INTO b6g_out SELECT 'bad_email', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'lead-2',
  'b6b40000-0000-0000-0000-000000000003',
  '[{"first_name":"Bez","last_name":"Adresu","email":"to-nie-adres"}]'::jsonb);
INSERT INTO b6g_out SELECT 'not_array', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'lead-2',
  'b6b40000-0000-0000-0000-000000000003', '{"first_name":"Nie","last_name":"Lista"}'::jsonb);
INSERT INTO b6g_out SELECT 'not_object', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'lead-2',
  'b6b40000-0000-0000-0000-000000000003', '["b6gg-str@example.org"]'::jsonb);
INSERT INTO b6g_out SELECT 'too_many', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'lead-2',
  'b6b40000-0000-0000-0000-000000000003',
  (SELECT jsonb_agg(jsonb_build_object('first_name', 'G', 'last_name', 'N' || g, 'email', 'b6gg-m' || g || '@example.org'))
     FROM generate_series(1, 50) AS g));
INSERT INTO b6g_out SELECT 'stranger', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c2', 'other-1',
  'b6b40000-0000-0000-0000-000000000003',
  '[{"first_name":"Cudzy","last_name":"Gosc","email":"b6gg-stranger@example.org"}]'::jsonb);
INSERT INTO b6g_out SELECT 'no_account', pg_temp.gg(NULL, 'anon-1',
  'b6b40000-0000-0000-0000-000000000003',
  '[{"first_name":"Bez","last_name":"Konta","email":"b6gg-anon@example.org"}]'::jsonb);
RESET ROLE;
SELECT ok((SELECT v->'client' = '{"ok": false, "error": "event_ended"}'::jsonb FROM b6g_out WHERE k = 'ended')
  AND NOT EXISTS (SELECT 1 FROM public.event_people p WHERE p.email_norm = 'b6gg-late@example.org'),
  'REG-13: wydarzenie zakonczone - event_ended (wartosc), bez zapisow');
SELECT is((SELECT v->'client' FROM b6g_out WHERE k = 'bad_email'), '{"ok": false, "error": "invalid_email"}'::jsonb,
  'invalid_email jako wartosc, bez ogona');
SELECT is((SELECT v->'client' FROM b6g_out WHERE k = 'not_array'), '{"ok": false, "error": "invalid_guests"}'::jsonb,
  'invalid_guests: lista nie jest tablica');
SELECT is((SELECT v->'client' FROM b6g_out WHERE k = 'not_object'), '{"ok": false, "error": "invalid_guests"}'::jsonb,
  'invalid_guests: wiersz listy nie jest obiektem');
SELECT is((SELECT v->'client' FROM b6g_out WHERE k = 'too_many'), '{"ok": false, "error": "group_too_large"}'::jsonb,
  'ponad 49 gosci - group_too_large bez czytania czegokolwiek (grupa ma najwyzej 50 osob)');
SELECT is((SELECT v FROM b6g_out WHERE k = 'stranger'),
  '{"client": {"ok": false, "error": "not_found"}, "delivery": []}'::jsonb,
  'cudze zgloszenie prowadzacego - not_found (wartosc), bez zapisow i bez dostawy');
SELECT ok(
  (SELECT v = '{"client": {"ok": false, "error": "account_required"}, "delivery": []}'::jsonb
     FROM b6g_out WHERE k = 'no_account')
  AND NOT EXISTS (SELECT 1 FROM public.rate_limits rl WHERE rl.subject_id = 'ip:' || md5('anon-1')),
  'bez konta - account_required (wartosc, bez kubelka)');

-- ── 35-37. REG-07: prowadzaca na miejscu z biletem bezplatnym ────────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO b6g_out SELECT 'free_lead', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'lead-3',
  'b6b40000-0000-0000-0000-000000000003',
  '[{"first_name":"Wolny","last_name":"Gosc","email":"b6gg-free@example.org"}]'::jsonb);
RESET ROLE;
SELECT ok(
  (SELECT r.status = 'approved' AND r.payment_status = 'not_required' AND r.qr_token_hash IS NOT NULL
      AND r.decision_source = 'system' AND r.decided_at IS NOT NULL
      AND r.quoted_price_cents IS NULL AND r.quote_valid_until IS NULL
     FROM public.event_registrations r
    WHERE r.group_lead_registration_id = 'b6b40000-0000-0000-0000-000000000003'),
  'prowadzaca na miejscu, bilet bezplatny - gosc przyjety z kodem QR i sladem decyzji (bez oferty)');
SELECT is((SELECT sold_count FROM public.event_ticket_types WHERE id = 'b6b20000-0000-0000-0000-000000000003'),
  2, 'przyjety gosc zajmuje miejsce w puli');

-- Prowadzaca przeniesiona do kolejki (pula pelna): goscie czekaja w pending.
UPDATE public.event_registrations SET status = 'waitlist', waitlist_position = 1, decision_source = 'capacity'
 WHERE id = 'b6b40000-0000-0000-0000-000000000003';
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO b6g_out SELECT 'waitlist_lead', pg_temp.gg('b6b00000-0000-0000-0000-0000000000c1', 'lead-3',
  'b6b40000-0000-0000-0000-000000000003',
  '[{"first_name":"Kolejkowy","last_name":"Gosc","email":"b6gg-queue@example.org"}]'::jsonb);
RESET ROLE;
SELECT ok(
  (SELECT r.status = 'pending' AND r.qr_token_hash IS NULL AND r.decision_source IS NULL
     FROM public.event_registrations r
     JOIN public.event_people p ON p.id = r.person_id
    WHERE p.email_norm = 'b6gg-queue@example.org'),
  'prowadzaca w kolejce - nowy gosc pending, bez kodu QR i bez cudzej decyzji');

-- ── 38-40. Wrapper zgodnosci: ten sam rdzen, sam `client` ────────────────────
INSERT INTO b6g_out SELECT 'legacy_ok', pg_temp.gg_legacy('b6b00000-0000-0000-0000-0000000000c1',
  'b6b40000-0000-0000-0000-000000000001',
  '[{"first_name":"Ktos","last_name":"Inny","email":"b6gg-member@example.org"},
    {"first_name":"Stary","last_name":"Front","email":"b6gg-legacy@example.org"}]'::jsonb);
SELECT is((SELECT v FROM b6g_out WHERE k = 'legacy_ok'), '{"ok": true, "added": 2}'::jsonb,
  'wrapper zgodnosci: gosc zapisany pominiety tak samo, odpowiedz bez dostawy i bez adresu');
SELECT ok(
  EXISTS (SELECT 1 FROM public.event_registrations r JOIN public.event_people p ON p.id = r.person_id
           WHERE p.email_norm = 'b6gg-legacy@example.org'
             AND r.group_lead_registration_id = 'b6b40000-0000-0000-0000-000000000001')
  AND (SELECT count(*) = 1 FROM public.event_registrations r
        WHERE r.person_id = 'b6b30000-0000-0000-0000-0000000000f1'),
  'wrapper zgodnosci: swiezy gosc dopisany, zapisany pominiety bez nowego wiersza');
SELECT is(
  (SELECT rl.count FROM public.rate_limits rl
    WHERE rl.scope = 'event_register.guests' AND rl.subject_id = 'user:b6b00000-0000-0000-0000-0000000000c2'),
  2, 'obce konto ma wlasny kubelek (not_found i rate_limited adresu tez liczone)');

SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '', true);
SELECT * FROM finish();
ROLLBACK;
