-- pgTAP: `event_register_group_guests` - koncowe cialo (REG-08, REG-07, REG-04,
-- REG-13, REG-16, REG-14/REG-02). Migracja
-- 20261012150100_event_group_guests_hardening.sql.
--
-- KRYTERIA:
--   * REG-04: kubelek konta `event_register.guests` (12 / 10 min) liczony
--     PRZED praca - odmowa nie cofa licznika, 13. proba to `rate_limited`
--     i niczego nie zapisuje; odmowy sa WARTOSCIA {ok:false, error, detail?},
--     a nie wyjatkiem (`detail` tylko przy `already_registered`).
--   * REG-13: wydarzenie zakonczone -> `event_ended`.
--   * REG-16: goscie dostaja oferte ceny prowadzacego (trzy kolumny razem).
--   * REG-14/REG-02: nowa osoba goscia `source = 'invitation'`, bez kolumn
--     zgod i bez wpisow w ksiedze zgod; istniejaca osoba nietknieta.
--   * REG-07: prowadzacy przyjety bez wplaty albo w kolejce -> goscie `pending`
--     bez kodu QR i bez miejsca; prowadzacy na miejscu z biletem bezplatnym ->
--     goscie przyjeci z kodem i sladem decyzji.
--   * REG-08: blokada wydarzenia przed zgloszeniem (statycznie; wyscig dwoch
--     sesji - harness 29_waitlist_settlement_group_locks.sql).
BEGIN;
SELECT plan(24);

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

-- Prowadzaca (osoba z kontem) i osoba ISTNIEJACA w kartotece (bez konta),
-- ktora prowadzaca wpisze jako goscia: jej dane i zgody nie moga sie zmienic.
INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, source,
                                 consent_data_processing_at, consent_marketing_at, consent_withdrawn_at) VALUES
  ('b6b30000-0000-0000-0000-0000000000c1', 'b6ba0000-0000-0000-0000-0000000000aa',
   'b6b00000-0000-0000-0000-0000000000c1', 'b6gg-lead@example.org', 'Lena', 'Prowadzaca', 'self_registration',
   now(), NULL, NULL),
  ('b6b30000-0000-0000-0000-0000000000e1', 'b6ba0000-0000-0000-0000-0000000000aa',
   NULL, 'b6gg-existing@example.org', 'Ewa', 'Prawdziwa', 'organizer',
   now() - interval '1 year', NULL, now() - interval '1 month');

-- L1: platny, przyjety przez organizatora PRZED wplata, z oferta ceny.
-- L2: zakonczone wydarzenie. L3: bezplatny, przyjety (system). L4: platny w kolejce.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
   decided_at, decision_source, created_by, quoted_price_cents, quoted_currency, quote_valid_until,
   waitlist_position) VALUES
  ('b6b40000-0000-0000-0000-000000000001', 'b6ba0000-0000-0000-0000-0000000000aa', 'b6b10000-0000-0000-0000-000000000001',
   'b6b30000-0000-0000-0000-0000000000c1', 'b6b20000-0000-0000-0000-000000000001', 'approved', 'form', 'unpaid',
   now(), 'organizer', 'b6b00000-0000-0000-0000-0000000000c1', 7500, 'PLN', now() + interval '72 hours', NULL),
  ('b6b40000-0000-0000-0000-000000000002', 'b6ba0000-0000-0000-0000-0000000000aa', 'b6b10000-0000-0000-0000-000000000002',
   'b6b30000-0000-0000-0000-0000000000c1', 'b6b20000-0000-0000-0000-000000000002', 'approved', 'form', 'not_required',
   now(), 'system', 'b6b00000-0000-0000-0000-0000000000c1', NULL, NULL, NULL, NULL),
  ('b6b40000-0000-0000-0000-000000000003', 'b6ba0000-0000-0000-0000-0000000000aa', 'b6b10000-0000-0000-0000-000000000003',
   'b6b30000-0000-0000-0000-0000000000c1', 'b6b20000-0000-0000-0000-000000000003', 'approved', 'form', 'not_required',
   now(), 'system', 'b6b00000-0000-0000-0000-0000000000c1', NULL, NULL, NULL, NULL);

CREATE TEMP TABLE b6g_out (k text PRIMARY KEY, v jsonb);
GRANT ALL ON b6g_out TO authenticated, service_role;

-- ── 1-2. Uprawnienia, kolejnosc blokad ───────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.event_register_group_guests(uuid,jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.event_register_group_guests(uuid,jsonb)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.event_register_group_guests(uuid,jsonb)', 'EXECUTE'),
  'ACL bez zmian: authenticated i service_role, nie anon');
SELECT ok(
  (SELECT strpos(p.prosrc, 'FROM public.events e') > 0
      AND strpos(p.prosrc, 'FROM public.events e') < strpos(p.prosrc, 'FROM public.event_ticket_types t')
      AND strpos(p.prosrc, 'FROM public.event_ticket_types t') < strpos(p.prosrc, 'FOR UPDATE OF r')
     FROM pg_proc p WHERE p.oid = 'public.event_register_group_guests(uuid,jsonb)'::regprocedure),
  'REG-08: blokady wydarzenie -> bilet -> zgloszenie prowadzacego');

-- Prowadzaca na hoscie najemcy.
SELECT set_config('request.headers', '{"x-tenant-host":"b6gg-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"sub":"b6b00000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- ── 3-9. REG-07 + REG-16 + REG-14: prowadzaca przyjeta bez wplaty ────────────
INSERT INTO b6g_out SELECT 'unpaid_lead', public.event_register_group_guests('b6b40000-0000-0000-0000-000000000001',
  '[{"first_name":"Nowy","last_name":"Gosc","email":"b6gg-new@example.org"},
    {"first_name":"Podszyty","last_name":"Ktos","email":"B6GG-EXISTING@example.org"}]'::jsonb);
RESET ROLE;

SELECT ok(
  (SELECT (v->>'ok')::boolean AND (v->>'added')::int = 2 AND jsonb_array_length(v->'registration_ids') = 2
     FROM b6g_out WHERE k = 'unpaid_lead'),
  'sukces: {ok:true, added, registration_ids}');
SELECT ok(
  (SELECT bool_and(r.status = 'pending' AND r.payment_status = 'unpaid' AND r.qr_token_hash IS NULL
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

-- ── 10-13. REG-04: odmowa to wartosc, kubelek liczy kazda probe ──────────────
SELECT set_config('request.jwt.claims', '{"sub":"b6b00000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO b6g_out SELECT 'dup', public.event_register_group_guests('b6b40000-0000-0000-0000-000000000001',
      '[{"first_name":"Nowy","last_name":"Gosc","email":"b6gg-new@example.org"}]'::jsonb)$$,
  'REG-04: odmowa nie jest wyjatkiem');
RESET ROLE;
SELECT is((SELECT v FROM b6g_out WHERE k = 'dup'),
  '{"ok": false, "error": "already_registered", "detail": "b6gg-new@example.org"}'::jsonb,
  'REG-04: already_registered jako wartosc z adresem goscia z listy prowadzacej');
SELECT is(
  (SELECT rl.count FROM public.rate_limits rl
    WHERE rl.scope = 'event_register.guests' AND rl.subject_id = 'user:b6b00000-0000-0000-0000-0000000000c1'),
  2, 'REG-04: kubelek konta liczy sukces i odmowe (odmowa nie cofa licznika)');

-- Kolejne proby az do limitu 12: 3..12 (odmowy group_too_large nie sa tu istotne).
SELECT set_config('request.jwt.claims', '{"sub":"b6b00000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  FOR i IN 3..12 LOOP
    PERFORM public.event_register_group_guests('b6b40000-0000-0000-0000-000000000003',
      '[{"first_name":"Za","last_name":"Duzo","email":"b6gg-x@example.org"},
        {"first_name":"Za","last_name":"Duzo","email":"b6gg-x@example.org"},
        {"first_name":"Za","last_name":"Duzo","email":"b6gg-x@example.org"},
        {"first_name":"Za","last_name":"Duzo","email":"b6gg-x@example.org"},
        {"first_name":"Za","last_name":"Duzo","email":"b6gg-x@example.org"},
        {"first_name":"Za","last_name":"Duzo","email":"b6gg-x@example.org"},
        {"first_name":"Za","last_name":"Duzo","email":"b6gg-x@example.org"},
        {"first_name":"Za","last_name":"Duzo","email":"b6gg-x@example.org"},
        {"first_name":"Za","last_name":"Duzo","email":"b6gg-x@example.org"},
        {"first_name":"Za","last_name":"Duzo","email":"b6gg-x@example.org"}]'::jsonb);
  END LOOP;
END $$;
INSERT INTO b6g_out SELECT 'thirteenth', public.event_register_group_guests('b6b40000-0000-0000-0000-000000000003',
  '[{"first_name":"Trzynasty","last_name":"Gosc","email":"b6gg-13@example.org"}]'::jsonb);
RESET ROLE;
SELECT ok(
  (SELECT v = '{"ok": false, "error": "rate_limited"}'::jsonb FROM b6g_out WHERE k = 'thirteenth')
  AND NOT EXISTS (SELECT 1 FROM public.event_people p WHERE p.email_norm = 'b6gg-13@example.org')
  AND NOT EXISTS (SELECT 1 FROM public.event_registrations r
                   WHERE r.group_lead_registration_id = 'b6b40000-0000-0000-0000-000000000003'),
  'REG-04: 13. proba w oknie - rate_limited, liczona przed praca (zero zapisow)');

-- ── 14-19. Pozostale odmowy jako wartosci ────────────────────────────────────
-- Osobne konto (wlasny kubelek) dla odmow, ktore nie maja zuzywac limitu wyzej.
UPDATE public.rate_limits SET count = 0
 WHERE scope = 'event_register.guests' AND subject_id = 'user:b6b00000-0000-0000-0000-0000000000c1';
SELECT set_config('request.jwt.claims', '{"sub":"b6b00000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO b6g_out SELECT 'ended', public.event_register_group_guests('b6b40000-0000-0000-0000-000000000002',
  '[{"first_name":"Po","last_name":"Czasie","email":"b6gg-late@example.org"}]'::jsonb);
INSERT INTO b6g_out SELECT 'bad_name', public.event_register_group_guests('b6b40000-0000-0000-0000-000000000003',
  '[{"first_name":"","last_name":"Bez","email":"b6gg-noname@example.org"}]'::jsonb);
INSERT INTO b6g_out SELECT 'not_array', public.event_register_group_guests('b6b40000-0000-0000-0000-000000000003',
  '{"first_name":"Nie","last_name":"Lista"}'::jsonb);
RESET ROLE;
SELECT is((SELECT v FROM b6g_out WHERE k = 'ended'), '{"ok": false, "error": "event_ended"}'::jsonb,
  'REG-13: wydarzenie zakonczone - event_ended (wartosc)');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.event_people p WHERE p.email_norm = 'b6gg-late@example.org'),
  'REG-13: odmowa event_ended niczego nie zapisuje');
SELECT is((SELECT v FROM b6g_out WHERE k = 'bad_name'), '{"ok": false, "error": "invalid_name"}'::jsonb,
  'invalid_name jako wartosc, bez ogona');
SELECT is((SELECT v FROM b6g_out WHERE k = 'not_array'), '{"ok": false, "error": "invalid_guests"}'::jsonb,
  'invalid_guests jako wartosc');

SELECT set_config('request.jwt.claims', '{"sub":"b6b00000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO b6g_out SELECT 'stranger', public.event_register_group_guests('b6b40000-0000-0000-0000-000000000003',
  '[{"first_name":"Cudzy","last_name":"Gosc","email":"b6gg-stranger@example.org"}]'::jsonb);
RESET ROLE;
SELECT is((SELECT v FROM b6g_out WHERE k = 'stranger'), '{"ok": false, "error": "not_found"}'::jsonb,
  'cudze zgloszenie prowadzacego - not_found (wartosc), bez zapisow');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO b6g_out SELECT 'no_account', public.event_register_group_guests('b6b40000-0000-0000-0000-000000000003',
  '[{"first_name":"Bez","last_name":"Konta","email":"b6gg-anon@example.org"}]'::jsonb);
RESET ROLE;
SELECT is((SELECT v FROM b6g_out WHERE k = 'no_account'), '{"ok": false, "error": "account_required"}'::jsonb,
  'bez konta - account_required (wartosc, bez kubelka)');

-- ── 20-22. REG-07: prowadzaca na miejscu z biletem bezplatnym ────────────────
SELECT set_config('request.jwt.claims', '{"sub":"b6b00000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO b6g_out SELECT 'free_lead', public.event_register_group_guests('b6b40000-0000-0000-0000-000000000003',
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
SELECT set_config('request.jwt.claims', '{"sub":"b6b00000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO b6g_out SELECT 'waitlist_lead', public.event_register_group_guests('b6b40000-0000-0000-0000-000000000003',
  '[{"first_name":"Kolejkowy","last_name":"Gosc","email":"b6gg-queue@example.org"}]'::jsonb);
RESET ROLE;
SELECT ok(
  (SELECT r.status = 'pending' AND r.qr_token_hash IS NULL AND r.decision_source IS NULL
     FROM public.event_registrations r
     JOIN public.event_people p ON p.id = r.person_id
    WHERE p.email_norm = 'b6gg-queue@example.org'),
  'prowadzaca w kolejce - nowy gosc pending, bez kodu QR i bez cudzej decyzji');

-- ── 23-24. Kubelek jest per konto i per zakres ───────────────────────────────
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.rate_limits rl
               WHERE rl.scope = 'event_register.guests' AND rl.subject_id NOT LIKE 'user:%'),
  'kubelek kluczowany wylacznie kontem (user:<uuid>), nigdy adresem z ladunku');
SELECT is(
  (SELECT rl.count FROM public.rate_limits rl
    WHERE rl.scope = 'event_register.guests' AND rl.subject_id = 'user:b6b00000-0000-0000-0000-0000000000c2'),
  1, 'obce konto ma wlasny kubelek (odmowa not_found tez liczona)');

SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '', true);
SELECT * FROM finish();
ROLLBACK;
