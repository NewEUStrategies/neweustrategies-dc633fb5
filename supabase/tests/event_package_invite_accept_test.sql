-- pgTAP: przyjecie zaproszenia na miejsce z pakietu (REG-15, REG-01;
-- migracja 20261012132200_event_package_invite_accept_verified).
--
-- DEFEKT (20260827221214:561-742). Funkcja byla martwa (zrodlo
-- 'package_invitation' spoza list CHECK, zerowanie skrotu tokenu wbrew parze
-- `event_package_seats_invite_pair`), a za tymi blokadami: konto posiadacza
-- linku wiazalo sie z kartoteka ZAPROSZONEGO bez porownania adresu (23505
-- dla konta z wlasna kartoteka), istniejaca osoba byla nadpisywana i dostawala
-- `consent_withdrawn_at = NULL`, wydarzenie (opublikowane, odwolane,
-- zakonczone), zamowienie zwrocone, regulamin i pola obowiazkowe nie byly
-- sprawdzane, a limit prob byl kluczowany ladunkiem i wycofywany kazdym
-- `RAISE invalid_token`.
--
-- CO PRZYPINA: pudlo tokenu jako WARTOSC z licznikiem, ktory zostaje;
-- straznik odmawia nawet dobrego tokenu przy pelnym kubelku; regulamin, pola,
-- stan wydarzenia i zamowienia; wiazanie konta wylacznie dla potwierdzonego
-- adresu zaproszenia; brak 23505 i brak nadpisania cudzej kartoteki; zrodlo
-- 'invitation'; miejsce zachowuje pare adres + skrot (ponownie: seat_taken);
-- akceptacja regulaminu z wersja bez dowodu z ladunku; zgody przez rejestr;
-- podglad (stan, maska adresu, account_matches).
BEGIN;
SELECT plan(40);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b2ba0000-0000-0000-0000-0000000000aa', 'epi-a', 'Package Invite A', 'epi-a.example'),
  ('b2ba0000-0000-0000-0000-0000000000bb', 'epi-b', 'Package Invite B', 'epi-b.example');

-- D: zaproszony (potwierdzony del@). W: potwierdzony w@, ma juz WLASNA
-- kartoteke - przyjmuje miejsce zaproszone na other@. U: niepotwierdzony,
-- przyjmuje miejsce zaproszone na jego wlasny adres. Z: konto z pelnym
-- kubelkiem pudel.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b2b00000-0000-0000-0000-0000000000d1', 'del@epi.example', now()),
  ('b2b00000-0000-0000-0000-0000000000d2', 'w@epi.example', now()),
  ('b2b00000-0000-0000-0000-0000000000d3', 'unconf@epi.example', NULL),
  ('b2b00000-0000-0000-0000-0000000000d4', 'z@epi.example', now());
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('b2b00000-0000-0000-0000-0000000000d1', 'del@epi.example', 'EPI D', 'b2ba0000-0000-0000-0000-0000000000aa'),
  ('b2b00000-0000-0000-0000-0000000000d2', 'w@epi.example', 'EPI W', 'b2ba0000-0000-0000-0000-0000000000aa'),
  ('b2b00000-0000-0000-0000-0000000000d3', 'unconf@epi.example', 'EPI U', 'b2ba0000-0000-0000-0000-0000000000aa'),
  ('b2b00000-0000-0000-0000-0000000000d4', 'z@epi.example', 'EPI Z', 'b2ba0000-0000-0000-0000-0000000000aa');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
  registration_mode, cancelled_at) VALUES
  ('b2be0000-0000-0000-0000-0000000000e1', 'b2ba0000-0000-0000-0000-0000000000aa', 'epi-e',
   'Kongres EPI', 'EPI Congress', now() + interval '30 days', NULL, 'published', 'form', NULL),
  ('b2be0000-0000-0000-0000-0000000000e2', 'b2ba0000-0000-0000-0000-0000000000aa', 'epi-cancelled',
   'Odwolane', 'Cancelled', now() + interval '30 days', NULL, 'published', 'form', now()),
  ('b2be0000-0000-0000-0000-0000000000e3', 'b2ba0000-0000-0000-0000-0000000000aa', 'epi-ended',
   'Zakonczone', 'Ended', now() - interval '3 days', now() - interval '2 days', 'published', 'form', NULL),
  ('b2be0000-0000-0000-0000-0000000000eb', 'b2ba0000-0000-0000-0000-0000000000bb', 'epi-b',
   'Obcy', 'Foreign', now() + interval '30 days', NULL, 'published', 'form', NULL);

INSERT INTO public.event_registration_fields (tenant_id, event_id, key, field_type, label_pl, label_en, is_required) VALUES
  ('b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e1', 'sector', 'text', 'Sektor', 'Sector', true);
INSERT INTO public.event_terms (id, tenant_id, event_id, key, label_pl, label_en, body_pl, is_required, display, version) VALUES
  ('b2bf0000-0000-0000-0000-0000000000f1', 'b2ba0000-0000-0000-0000-0000000000aa',
   'b2be0000-0000-0000-0000-0000000000e1', 'epi_terms', 'Regulamin EPI', 'EPI terms', 'Tresc regulaminu EPI.',
   true, 'registration', 3);

INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency) VALUES
  ('b2b70000-0000-0000-0000-0000000000a1', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e1', 'epi_std', 'Standard', 'Standard', 20000, 'PLN'),
  ('b2b70000-0000-0000-0000-0000000000a2', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e2', 'epi_std', 'Standard', 'Standard', 20000, 'PLN'),
  ('b2b70000-0000-0000-0000-0000000000a3', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e3', 'epi_std', 'Standard', 'Standard', 20000, 'PLN'),
  ('b2b70000-0000-0000-0000-0000000000ab', 'b2ba0000-0000-0000-0000-0000000000bb', 'b2be0000-0000-0000-0000-0000000000eb', 'epi_std', 'Standard', 'Standard', 20000, 'PLN');
INSERT INTO public.event_ticket_packages (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, audience, seats, price_cents, currency) VALUES
  ('b2b80000-0000-0000-0000-0000000000a1', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e1', 'b2b70000-0000-0000-0000-0000000000a1', 'epi_pack', 'Pakiet', 'Pack', 'public', 5, 90000, 'PLN'),
  ('b2b80000-0000-0000-0000-0000000000a2', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e2', 'b2b70000-0000-0000-0000-0000000000a2', 'epi_pack', 'Pakiet', 'Pack', 'public', 2, 30000, 'PLN'),
  ('b2b80000-0000-0000-0000-0000000000a3', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e3', 'b2b70000-0000-0000-0000-0000000000a3', 'epi_pack', 'Pakiet', 'Pack', 'public', 2, 30000, 'PLN'),
  ('b2b80000-0000-0000-0000-0000000000ab', 'b2ba0000-0000-0000-0000-0000000000bb', 'b2be0000-0000-0000-0000-0000000000eb', 'b2b70000-0000-0000-0000-0000000000ab', 'epi_pack', 'Pakiet', 'Pack', 'public', 2, 30000, 'PLN');
INSERT INTO public.event_package_orders (id, tenant_id, event_id, package_id, buyer_email, seats_total, status, amount_cents, paid_at) VALUES
  ('b2b90000-0000-0000-0000-0000000000a1', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e1', 'b2b80000-0000-0000-0000-0000000000a1', 'buyer@epi.example', 5, 'paid', 90000, now()),
  ('b2b90000-0000-0000-0000-0000000000a2', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e2', 'b2b80000-0000-0000-0000-0000000000a2', 'buyer@epi.example', 2, 'paid', 30000, now()),
  ('b2b90000-0000-0000-0000-0000000000a3', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e3', 'b2b80000-0000-0000-0000-0000000000a3', 'buyer@epi.example', 2, 'paid', 30000, now()),
  ('b2b90000-0000-0000-0000-0000000000a4', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e1', 'b2b80000-0000-0000-0000-0000000000a1', 'buyer2@epi.example', 5, 'refunded', 90000, now()),
  ('b2b90000-0000-0000-0000-0000000000ab', 'b2ba0000-0000-0000-0000-0000000000bb', 'b2be0000-0000-0000-0000-0000000000eb', 'b2b80000-0000-0000-0000-0000000000ab', 'buyer@epi.example', 2, 'paid', 30000, now());

-- Tokeny jawne (32 znaki) zostaja w tabeli tymczasowej; w bazie, jak
-- w `admin_event_package_seat_invite`, wylacznie ich sha256.
CREATE TEMP TABLE epi_tok (k text PRIMARY KEY, token text NOT NULL);
GRANT SELECT ON epi_tok TO anon, authenticated, service_role;
INSERT INTO epi_tok VALUES
  ('del', 'epiDEL' || repeat('a', 26)), ('oth', 'epiOTH' || repeat('b', 26)),
  ('cxl', 'epiCXL' || repeat('c', 26)), ('end', 'epiEND' || repeat('d', 26)),
  ('ref', 'epiREF' || repeat('e', 26)), ('grd', 'epiGRD' || repeat('f', 26)),
  ('exp', 'epiEXP' || repeat('g', 26)), ('unc', 'epiUNC' || repeat('h', 26)),
  ('frn', 'epiFRN' || repeat('i', 26)), ('miss', 'epiMIS' || repeat('j', 26)),
  ('new', 'epiNEW' || repeat('k', 26));
INSERT INTO public.event_package_seats (id, tenant_id, event_id, package_order_id, invite_email, invite_name,
  invite_token_hash, invite_sent_at, invite_expires_at) VALUES
  ('b2bc0000-0000-0000-0000-0000000000c1', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e1', 'b2b90000-0000-0000-0000-0000000000a1',
   'del@epi.example', 'Dorota', encode(extensions.digest((SELECT token FROM epi_tok WHERE k = 'del'), 'sha256'), 'hex'), now(), now() + interval '7 days'),
  ('b2bc0000-0000-0000-0000-0000000000c2', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e1', 'b2b90000-0000-0000-0000-0000000000a1',
   'other@epi.example', '', encode(extensions.digest((SELECT token FROM epi_tok WHERE k = 'oth'), 'sha256'), 'hex'), now(), NULL),
  ('b2bc0000-0000-0000-0000-0000000000c3', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e2', 'b2b90000-0000-0000-0000-0000000000a2',
   'cx@epi.example', '', encode(extensions.digest((SELECT token FROM epi_tok WHERE k = 'cxl'), 'sha256'), 'hex'), now(), NULL),
  ('b2bc0000-0000-0000-0000-0000000000c4', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e3', 'b2b90000-0000-0000-0000-0000000000a3',
   'end@epi.example', '', encode(extensions.digest((SELECT token FROM epi_tok WHERE k = 'end'), 'sha256'), 'hex'), now() - interval '5 days', NULL),
  ('b2bc0000-0000-0000-0000-0000000000c5', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e1', 'b2b90000-0000-0000-0000-0000000000a4',
   'ref@epi.example', '', encode(extensions.digest((SELECT token FROM epi_tok WHERE k = 'ref'), 'sha256'), 'hex'), now(), NULL),
  ('b2bc0000-0000-0000-0000-0000000000c6', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e1', 'b2b90000-0000-0000-0000-0000000000a1',
   'grd@epi.example', '', encode(extensions.digest((SELECT token FROM epi_tok WHERE k = 'grd'), 'sha256'), 'hex'), now(), NULL),
  ('b2bc0000-0000-0000-0000-0000000000c7', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e1', 'b2b90000-0000-0000-0000-0000000000a1',
   'exp@epi.example', '', encode(extensions.digest((SELECT token FROM epi_tok WHERE k = 'exp'), 'sha256'), 'hex'),
   now() - interval '10 days', now() - interval '1 day'),
  ('b2bc0000-0000-0000-0000-0000000000c8', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e1', 'b2b90000-0000-0000-0000-0000000000a1',
   'unconf@epi.example', '', encode(extensions.digest((SELECT token FROM epi_tok WHERE k = 'unc'), 'sha256'), 'hex'), now(), NULL),
  ('b2bc0000-0000-0000-0000-0000000000c9', 'b2ba0000-0000-0000-0000-0000000000aa', 'b2be0000-0000-0000-0000-0000000000e1', 'b2b90000-0000-0000-0000-0000000000a1',
   'nw@epi.example', '', encode(extensions.digest((SELECT token FROM epi_tok WHERE k = 'new'), 'sha256'), 'hex'), now(), NULL),
  ('b2bc0000-0000-0000-0000-0000000000cb', 'b2ba0000-0000-0000-0000-0000000000bb', 'b2be0000-0000-0000-0000-0000000000eb', 'b2b90000-0000-0000-0000-0000000000ab',
   'frn@epi.example', '', encode(extensions.digest((SELECT token FROM epi_tok WHERE k = 'frn'), 'sha256'), 'hex'), now(), NULL);

-- Kartoteki: W (dowiazana do W), other@ (gosc bez konta, wycofal zgody).
INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, job_title,
  consent_data_processing_at, consent_withdrawn_at, created_by) VALUES
  ('b2bd0000-0000-0000-0000-0000000000d2', 'b2ba0000-0000-0000-0000-0000000000aa',
   'b2b00000-0000-0000-0000-0000000000d2', 'w@epi.example', 'Wanda', 'Wlasna', NULL,
   '2026-01-01 10:00+00', NULL, 'b2b00000-0000-0000-0000-0000000000d2'),
  ('b2bd0000-0000-0000-0000-0000000000e9', 'b2ba0000-0000-0000-0000-0000000000aa',
   NULL, 'other@epi.example', 'Olga', 'Other', 'Analityczka',
   '2026-01-01 10:00+00', '2026-02-01 10:00+00', NULL);

CREATE TEMP TABLE epi_r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON epi_r TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.epi_payload(p_tok text, p_terms boolean, p_answers jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'token', (SELECT token FROM epi_tok WHERE k = p_tok),
    'first_name', 'Dorota', 'last_name', 'Delegat', 'job_title', 'Dyrektorka',
    'consent_data_processing', true, 'consent_marketing', true,
    'answers', p_answers,
    'accepted_term_ids', CASE WHEN p_terms THEN jsonb_build_array('b2bf0000-0000-0000-0000-0000000000f1') ELSE '[]'::jsonb END,
    -- Dowod z ladunku: musi zostac zignorowany.
    'ip_hash', 'deadbeefdeadbeef', 'user_agent', 'forged/1.0')
$$;
GRANT EXECUTE ON FUNCTION pg_temp.epi_payload(text, boolean, jsonb) TO anon, authenticated;

-- ── 1-2. ACL ─────────────────────────────────────────────────────────────────
SELECT ok(
  has_function_privilege('anon', 'public.event_package_invite_accept(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_package_invite_accept(jsonb)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.event_package_invite_preview(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_package_invite_preview(jsonb)', 'EXECUTE'),
  'przyjecie i podglad zaproszenia: anon i authenticated (link otwiera tez gosc)');
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_invite_probe_guard(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_invite_probe_guard(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_invite_probe_miss(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_invite_probe_miss(uuid,uuid)', 'EXECUTE'),
  'kubelki pudel tokenu: brak EXECUTE dla rol klienta');

-- ── 3-8. Pudla tokenu jako wartosc, licznik zostaje; podglad ────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"epi-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
INSERT INTO epi_r VALUES
  ('bad_shape', public.event_package_invite_accept(jsonb_build_object('token', 'too-short', 'first_name', 'A', 'last_name', 'B', 'consent_data_processing', true))),
  ('miss', public.event_package_invite_accept(pg_temp.epi_payload('miss', true, '{"sector":"x"}'::jsonb))),
  ('foreign', public.event_package_invite_accept(pg_temp.epi_payload('frn', true, '{"sector":"x"}'::jsonb))),
  ('prev_anon', public.event_package_invite_preview(jsonb_build_object('token', (SELECT token FROM epi_tok WHERE k = 'del'))));
RESET ROLE;
SELECT is((SELECT v FROM epi_r WHERE k = 'bad_shape'), '{"ok": false, "error": "invalid_token"}'::jsonb,
  'token w zlym ksztalcie: odmowa wartoscia, bez wyjatku');
SELECT is((SELECT v FROM epi_r WHERE k = 'miss'), '{"ok": false, "error": "invalid_token"}'::jsonb,
  'nieznany token: invalid_token jako WARTOSC (nie wyjatek, ktory wycofalby licznik)');
SELECT is((SELECT v FROM epi_r WHERE k = 'foreign'), '{"ok": false, "error": "invalid_token"}'::jsonb,
  'token miejsca obcego najemcy: ta sama odpowiedz co nieznany token');
SELECT is(
  (SELECT rl.count FROM public.rate_limits rl
    WHERE rl.scope = 'event_invite_miss.tenant' AND rl.subject_id = 'tenant:b2ba0000-0000-0000-0000-0000000000aa'),
  2,
  'pudla zliczone w kubelku najemcy (2: nieznany i obcy; zly ksztalt nie liczy) - licznik nie wycofany');
SELECT ok(
  (SELECT v->>'ok' = 'true' AND v->>'state' = 'open' AND v->>'event_slug' = 'epi-e'
          AND v->>'invite_email_hint' = 'd***@epi.example' AND v->>'invite_name' = 'Dorota'
          AND v->>'account_matches' = 'false' AND NOT (v ? 'invite_email')
     FROM epi_r WHERE k = 'prev_anon'),
  'podglad dla goscia: stan open, slug do formularza, zamaskowany adres, account_matches false');

SELECT set_config('request.jwt.claims',
  '{"sub":"b2b00000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO epi_r VALUES
  ('prev_d', public.event_package_invite_preview(jsonb_build_object('token', (SELECT token FROM epi_tok WHERE k = 'del'))));
RESET ROLE;
SELECT is((SELECT v->>'account_matches' FROM epi_r WHERE k = 'prev_d'), 'true',
  'podglad dla zaproszonego z potwierdzonym adresem: account_matches true');

-- ── 9-15. Regulamin, pola, wydarzenie, zamowienie, termin ────────────────────
SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$SELECT public.event_package_invite_accept(pg_temp.epi_payload('del', false, '{"sector":"energia"}'::jsonb))$$,
  'terms_required%', 'bez akceptacji obowiazkowego regulaminu -> terms_required');
SELECT throws_like(
  $$SELECT public.event_package_invite_accept(pg_temp.epi_payload('del', true, '{}'::jsonb))$$,
  'missing_required_fields: sector%', 'bez obowiazkowego pola formularza -> missing_required_fields');
SELECT throws_like(
  $$SELECT public.event_package_invite_accept(pg_temp.epi_payload('end', true, '{}'::jsonb))$$,
  'event_ended%', 'zaproszenie na zakonczone wydarzenie -> event_ended');
SELECT throws_like(
  $$SELECT public.event_package_invite_accept(pg_temp.epi_payload('cxl', true, '{}'::jsonb))$$,
  'event_cancelled%', 'zaproszenie na odwolane wydarzenie -> event_cancelled');
SELECT throws_like(
  $$SELECT public.event_package_invite_accept(pg_temp.epi_payload('ref', true, '{"sector":"x"}'::jsonb))$$,
  'order_refunded%', 'miejsce ze zwroconego zamowienia -> order_refunded');
SELECT throws_like(
  $$SELECT public.event_package_invite_accept(pg_temp.epi_payload('exp', true, '{"sector":"x"}'::jsonb))$$,
  'invitation_expired%', 'zaproszenie po terminie -> invitation_expired');
SELECT throws_like(
  $$SELECT public.event_package_invite_accept(pg_temp.epi_payload('del', true, '{"sector":"x"}'::jsonb) || '{"first_name":""}'::jsonb)$$,
  'invalid_name%', 'puste imie -> invalid_name (sufity pol jak w zapisie)');
RESET ROLE;
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_registrations WHERE tenant_id = 'b2ba0000-0000-0000-0000-0000000000aa')
  AND (SELECT registration_id IS NULL FROM public.event_package_seats WHERE id = 'b2bc0000-0000-0000-0000-0000000000c1'),
  'odmowy nie zostawiaja zgloszenia, miejsce zostaje wolne');

-- ── 17-24. Posiadacz linku z wlasna kartoteka nie przejmuje cudzej ───────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b2b00000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO epi_r VALUES
  ('w_oth', public.event_package_invite_accept(pg_temp.epi_payload('oth', true, '{"sector":"przemysl"}'::jsonb))),
  ('w_new', public.event_package_invite_accept(pg_temp.epi_payload('new', true, '{"sector":"przemysl"}'::jsonb)));
RESET ROLE;
SELECT ok(
  (SELECT v->>'ok' = 'true' AND v->>'account_linked' = 'false' FROM epi_r WHERE k = 'w_new')
  AND (SELECT user_id IS NULL AND created_by = 'b2b00000-0000-0000-0000-0000000000d2'
         FROM public.event_people WHERE tenant_id = 'b2ba0000-0000-0000-0000-0000000000aa'
          AND email_norm = 'nw@epi.example'),
  'konto W (dowiazane do wlasnej kartoteki) przyjmuje zaproszenie na NOWY adres: bez 23505, nowa osoba bez dowiazania');
SELECT ok(
  (SELECT v->>'ok' = 'true' AND v->>'account_linked' = 'false' AND v->>'event_slug' = 'epi-e'
          AND length(v->>'qr_token') = 32 AND length(v->>'manage_token') = 32
     FROM epi_r WHERE k = 'w_oth'),
  'konto W z wlasna kartoteka przyjmuje zaproszenie na other@ - bez 23505, account_linked false');
SELECT ok(
  (SELECT user_id IS NULL AND first_name = 'Olga' AND last_name = 'Other' AND job_title = 'Analityczka'
          AND consent_withdrawn_at = '2026-02-01 10:00+00' AND consent_data_processing_at = '2026-01-01 10:00+00'
          AND consent_marketing_at IS NULL
     FROM public.event_people WHERE id = 'b2bd0000-0000-0000-0000-0000000000e9'),
  'cudza kartoteka other@ nietknieta: bez konta, imie, nazwisko, stanowisko, zgody i wycofanie bez zmian');
SELECT is(
  (SELECT r.submitted_profile FROM public.event_registrations r
    WHERE r.id = (SELECT (v->>'registration_id')::uuid FROM epi_r WHERE k = 'w_oth')),
  '{"first_name": "Dorota", "last_name": "Delegat", "job_title": "Dyrektorka"}'::jsonb,
  'dane posiadacza linku trafiaja do submitted_profile zgloszenia (wglad organizatora)');
SELECT ok(
  (SELECT user_id = 'b2b00000-0000-0000-0000-0000000000d2' FROM public.event_people
    WHERE id = 'b2bd0000-0000-0000-0000-0000000000d2'),
  'wlasna kartoteka W nadal dowiazana do W');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_consent_records c
               WHERE c.person_id = 'b2bd0000-0000-0000-0000-0000000000e9' AND c.purpose = 'marketing')
  AND EXISTS (SELECT 1 FROM public.event_consent_records c
               WHERE c.person_id = 'b2bd0000-0000-0000-0000-0000000000e9' AND c.purpose = 'data_processing'
                 AND c.status = 'confirmed' AND c.evidence = 'registration_form'
                 AND c.registration_id = (SELECT (v->>'registration_id')::uuid FROM epi_r WHERE k = 'w_oth')
                 AND c.ip_subject IS NULL AND c.user_agent IS NULL),
  'zgody posiadacza linku: przetwarzanie danych w ksiedze (bez dowodu z ladunku), marketing NIE zapisany');

-- U (niepotwierdzony) przyjmuje zaproszenie na SWOJ adres.
SELECT set_config('request.jwt.claims',
  '{"sub":"b2b00000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO epi_r VALUES
  ('u_unc', public.event_package_invite_accept(pg_temp.epi_payload('unc', true, '{"sector":"nauka"}'::jsonb)));
RESET ROLE;
SELECT ok(
  (SELECT v->>'account_linked' = 'false' FROM epi_r WHERE k = 'u_unc')
  AND (SELECT user_id IS NULL AND created_by = 'b2b00000-0000-0000-0000-0000000000d3'
         FROM public.event_people WHERE tenant_id = 'b2ba0000-0000-0000-0000-0000000000aa'
          AND email_norm = 'unconf@epi.example'),
  'konto bez potwierdzonego adresu: nowa osoba zaproszenia powstaje BEZ dowiazania');

-- ── 24-31. Zaproszony z potwierdzonym adresem ───────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b2b00000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO epi_r VALUES
  ('d_del', public.event_package_invite_accept(pg_temp.epi_payload('del', true, '{"sector":"energia"}'::jsonb)));
RESET ROLE;
SELECT ok(
  (SELECT v->>'ok' = 'true' AND v->>'account_linked' = 'true' AND v->>'status' = 'approved'
     FROM epi_r WHERE k = 'd_del')
  AND (SELECT user_id = 'b2b00000-0000-0000-0000-0000000000d1' AND first_name = 'Dorota'
         FROM public.event_people WHERE tenant_id = 'b2ba0000-0000-0000-0000-0000000000aa'
          AND email_norm = 'del@epi.example'),
  'zaproszony z potwierdzonym adresem: kartoteka del@ dowiazana do jego konta, account_linked true');
-- SCALENIE Z MAIN (PR #504): zrodlo `package_invitation` (main 20261012130000/
-- 130001, TIX-07/TIX-04: CHECK-i dostaly te wartosc, a oplacenie i anulowanie
-- zamowienia znajduja po niej delegatow) zamiast `invitation` (REG
-- 20261012132200 - obejscie starego CHECK-u). Unia: 20261013900400.
SELECT ok(
  (SELECT bool_and(p.source = 'package_invitation') FROM public.event_people p
    WHERE p.tenant_id = 'b2ba0000-0000-0000-0000-0000000000aa'
      AND p.email_norm IN ('del@epi.example', 'unconf@epi.example', 'nw@epi.example'))
  AND (SELECT count(*) = 4 AND bool_and(r.source = 'package_invitation' AND r.status = 'approved'
                                        AND r.registration_mode = 'form')
         FROM public.event_registrations r WHERE r.tenant_id = 'b2ba0000-0000-0000-0000-0000000000aa'),
  'zrodlo package_invitation w kartotece i zgloszeniu (dozwolone przez CHECK), zgloszenia zatwierdzone w trybie form');
SELECT ok(
  (SELECT s.registration_id = (SELECT (v->>'registration_id')::uuid FROM epi_r WHERE k = 'd_del')
          AND s.assigned_at IS NOT NULL
          AND s.invite_email = 'del@epi.example'
          AND s.invite_token_hash = encode(extensions.digest((SELECT token FROM epi_tok WHERE k = 'del'), 'sha256'), 'hex')
     FROM public.event_package_seats s WHERE s.id = 'b2bc0000-0000-0000-0000-0000000000c1')
  AND (SELECT seats_assigned = 4 FROM public.event_package_orders WHERE id = 'b2b90000-0000-0000-0000-0000000000a1'),
  'miejsce przypisane, adres i skrot tokenu zostaja (para CHECK), licznik zamowienia 4');

SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$SELECT public.event_package_invite_accept(pg_temp.epi_payload('del', true, '{"sector":"energia"}'::jsonb))$$,
  'seat_taken%', 'ponowne uzycie linku -> seat_taken');
INSERT INTO epi_r VALUES
  ('prev_used', public.event_package_invite_preview(jsonb_build_object('token', (SELECT token FROM epi_tok WHERE k = 'del')))),
  ('prev_end', public.event_package_invite_preview(jsonb_build_object('token', (SELECT token FROM epi_tok WHERE k = 'end')))),
  ('prev_ref', public.event_package_invite_preview(jsonb_build_object('token', (SELECT token FROM epi_tok WHERE k = 'ref')))),
  ('prev_exp', public.event_package_invite_preview(jsonb_build_object('token', (SELECT token FROM epi_tok WHERE k = 'exp'))));
RESET ROLE;
SELECT is(
  (SELECT string_agg(v->>'state', ',' ORDER BY k) FROM epi_r WHERE k IN ('prev_used', 'prev_end', 'prev_ref', 'prev_exp')),
  'event_ended,expired,order_refunded,used',
  'podglad: stany event_ended, expired, order_refunded i used');
SELECT ok(
  EXISTS (SELECT 1 FROM public.event_term_acceptances a
           WHERE a.term_id = 'b2bf0000-0000-0000-0000-0000000000f1'
             AND a.registration_id = (SELECT (v->>'registration_id')::uuid FROM epi_r WHERE k = 'd_del')
             AND a.version = 3 AND a.ip_hash IS NULL AND a.user_agent IS NULL),
  'akceptacja regulaminu z wersja 3; ip_hash i user_agent z ladunku zignorowane (NULL)');
SELECT ok(
  EXISTS (SELECT 1 FROM public.event_consent_records c
           JOIN public.event_people p ON p.id = c.person_id
          WHERE p.email_norm = 'del@epi.example' AND c.purpose = 'marketing'
            AND c.status = 'confirmed' AND c.evidence = 'verified_account')
  AND (SELECT consent_marketing_at IS NOT NULL AND consent_data_processing_at IS NOT NULL
         FROM public.event_people WHERE email_norm = 'del@epi.example'
          AND tenant_id = 'b2ba0000-0000-0000-0000-0000000000aa')
  AND (SELECT (v->>'marketing_recorded')::boolean FROM epi_r WHERE k = 'd_del'),
  'zweryfikowany wlasciciel: marketing przez rejestr (verified_account) z projekcja');
SELECT ok(
  NOT (SELECT (v->>'marketing_recorded')::boolean FROM epi_r WHERE k = 'w_oth')
  AND NOT (SELECT (v->>'marketing_recorded')::boolean FROM epi_r WHERE k = 'u_unc'),
  'zaznaczony marketing niezweryfikowanego posiadacza linku nie jest zapisywany (brak DOI na tej sciezce)');

-- ── 32-40. Straznik: pelny kubelek odmawia nawet dobrego tokenu ──────────────
INSERT INTO public.rate_limits (scope, subject_id, window_start, count)
VALUES ('event_invite_miss.tenant', 'tenant:b2ba0000-0000-0000-0000-0000000000aa',
        to_timestamp((floor(extract(epoch FROM now()) / 600) * 600)::double precision), 300)
ON CONFLICT (scope, subject_id, window_start) DO UPDATE SET count = 300;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT throws_like(
  $$SELECT public.event_package_invite_accept(pg_temp.epi_payload('grd', true, '{"sector":"x"}'::jsonb))$$,
  'rate_limited%', 'pelny kubelek najemcy: DOBRY token tez dostaje rate_limited (brak wyroczni)');
SELECT throws_like(
  $$SELECT public.event_package_invite_preview(jsonb_build_object('token', (SELECT token FROM epi_tok WHERE k = 'grd')))$$,
  'rate_limited%', 'pelny kubelek najemcy: podglad tez odmawia');
RESET ROLE;
SELECT ok(
  (SELECT registration_id IS NULL FROM public.event_package_seats WHERE id = 'b2bc0000-0000-0000-0000-0000000000c6'),
  'odmowa straznika nie zajmuje miejsca');
DELETE FROM public.rate_limits
 WHERE scope = 'event_invite_miss.tenant' AND subject_id = 'tenant:b2ba0000-0000-0000-0000-0000000000aa';

-- Kubelek konta (wspolny z sondami kodow): pudla Z liczone i blokujace.
SELECT set_config('request.jwt.claims',
  '{"sub":"b2b00000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO epi_r VALUES
  ('z_miss', public.event_package_invite_accept(pg_temp.epi_payload('miss', true, '{}'::jsonb)));
RESET ROLE;
SELECT ok(
  (SELECT v->>'error' = 'invalid_token' FROM epi_r WHERE k = 'z_miss')
  AND (SELECT rl.count = 1 FROM public.rate_limits rl
        WHERE rl.scope = 'coupon_probe_miss' AND rl.subject_id = 'user:b2b00000-0000-0000-0000-0000000000d4'),
  'pudlo zalogowanego liczone tez w kubelku konta (coupon_probe_miss)');
UPDATE public.rate_limits SET count = 30
 WHERE scope = 'coupon_probe_miss' AND subject_id = 'user:b2b00000-0000-0000-0000-0000000000d4';
SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$SELECT public.event_package_invite_accept(pg_temp.epi_payload('grd', true, '{"sector":"x"}'::jsonb))$$,
  'rate_limited%', 'pelny kubelek konta: dobry token tez dostaje rate_limited');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
INSERT INTO epi_r VALUES
  ('anon_grd', public.event_package_invite_accept(pg_temp.epi_payload('grd', true, '{"sector":"x"}'::jsonb)));
RESET ROLE;
SELECT ok(
  (SELECT v->>'ok' = 'true' AND v->>'account_linked' = 'false' FROM epi_r WHERE k = 'anon_grd')
  AND (SELECT user_id IS NULL AND created_by IS NULL FROM public.event_people
        WHERE tenant_id = 'b2ba0000-0000-0000-0000-0000000000aa' AND email_norm = 'grd@epi.example'),
  'gosc bez konta przyjmuje zaproszenie: kartoteka bez dowiazania');
SELECT ok(
  (SELECT count(*) = 1 FROM public.event_registrations r
    JOIN public.event_people p ON p.id = r.person_id
   WHERE p.email_norm = 'grd@epi.example' AND r.tenant_id = 'b2ba0000-0000-0000-0000-0000000000aa'),
  'po zdjeciu blokady to samo miejsce przyjmuje sie raz');
SELECT is(
  (SELECT count(*)::integer FROM public.domain_events d
    WHERE d.tenant_id = 'b2ba0000-0000-0000-0000-0000000000aa'
      AND d.event_type = 'event.registration.created.v1'
      AND d.payload->>'source' = 'package_invitation'),
  5,
  -- SCALENIE Z MAIN (PR #504): zrodlo jak w wierszu (main TIX-07, REG-15).
  'kazde przyjecie emituje event.registration.created.v1 ze zrodlem package_invitation');
SELECT throws_like(
  $$UPDATE public.event_package_seats SET invite_token_hash = NULL
     WHERE id = 'b2bc0000-0000-0000-0000-0000000000c1'$$,
  '%event_package_seats_invite_pair%',
  'para adres + skrot tokenu nadal wymuszana przez CHECK (stara konsumpcja byla niemozliwa)');

SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '', true);
SELECT * FROM finish();
ROLLBACK;
