-- pgTAP: notatka wewnetrzna organizatora (`decision_note`) nie dociera do
-- uczestnika zadna droga; jedynym tekstem decyzji dla uczestnika jest
-- `participant_reason` (REG-06, decyzja D10). Migracje 20261012170100
-- (decyzja organizatora, kolumna) i 20261012170200 (granty kolumnowe,
-- „Moje zgloszenia", dane do maila).
--
-- KRYTERIUM AUDYTU REG-06: „event_my_registrations nie zwraca decision_note"
-- - dla KAZDEGO statusu, takze przyjetego zgloszenia z notatka. Do tego trzy
-- pozostale drogi wycieku: bezposredni odczyt tabeli przez PostgREST (granty
-- kolumnowe, takze hasze kluczy, dane z niezweryfikowanego formularza
-- i `event_people.notes`), dane do maila o decyzji i klucz samoobslugi.
-- Polityki RLS innych tabel, ktore czytaja `event_registrations`
-- (spotkania), nadal dzialaja - uczestnik widzi swoje spotkanie.
BEGIN;
SELECT plan(37);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b46a0000-0000-0000-0000-0000000000aa', 'b4pr-a', 'B4 Reason A', 'b4pr-a.example');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b4600000-0000-0000-0000-0000000000a1', 'b4pr-admin@example.org', now()),
  ('b4600000-0000-0000-0000-0000000000c1', 'b4pr-participant@example.org', now()),
  ('b4600000-0000-0000-0000-0000000000c2', 'b4pr-partner@example.org', now());

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('b4600000-0000-0000-0000-0000000000a1', 'b4pr-admin@example.org', 'Admin', 'b46a0000-0000-0000-0000-0000000000aa'),
  ('b4600000-0000-0000-0000-0000000000c1', 'b4pr-participant@example.org', 'Uczestnik', 'b46a0000-0000-0000-0000-0000000000aa'),
  ('b4600000-0000-0000-0000-0000000000c2', 'b4pr-partner@example.org', 'Partner', 'b46a0000-0000-0000-0000-0000000000aa');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('b4600000-0000-0000-0000-0000000000a1', 'admin', 'b46a0000-0000-0000-0000-0000000000aa');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode)
SELECT ('b4610000-0000-0000-0000-00000000000' || s)::uuid, 'b46a0000-0000-0000-0000-0000000000aa',
       'b4pr-' || s, 'B4 powod ' || s, 'B4 reason ' || s, now() + interval '30 days', 'published', 'form'
  FROM unnest(ARRAY['1', '2', '3', '4', '5', '6', '7', '8']) AS s;

-- Notatki organizatora o osobie (event_people.notes) - wewnetrzne.
INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, notes) VALUES
  ('b4630000-0000-0000-0000-0000000000c1', 'b46a0000-0000-0000-0000-0000000000aa',
   'b4600000-0000-0000-0000-0000000000c1', 'b4pr-participant@example.org', 'Ula', 'Uczestnik',
   'OSOBA-WEWN: trudny kontakt'),
  ('b4630000-0000-0000-0000-0000000000c2', 'b46a0000-0000-0000-0000-0000000000aa',
   'b4600000-0000-0000-0000-0000000000c2', 'b4pr-partner@example.org', 'Piotr', 'Partner', NULL);

-- Zgloszenia uczestnika w KAZDYM statusie, kazde z notatka wewnetrzna (WEWN).
-- r1 przyjete z notatka i kluczem samoobslugi, r2 odrzucone z powodem dla
-- uczestnika, r3 anulowane bez powodu, r4 przyjete z NIEAKTUALNYM powodem
-- (ponownie otwarte), r5 oczekujace (decyzje w tescie), r6 kolejka, r7 obecny.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, payment_status, decided_at, decided_by,
   decision_source, decision_note, participant_reason, cancelled_at, attended_at, waitlist_position,
   manage_token_hash, submitted_profile) VALUES
  ('b4640000-0000-0000-0000-000000000001', 'b46a0000-0000-0000-0000-0000000000aa', 'b4610000-0000-0000-0000-000000000001',
   'b4630000-0000-0000-0000-0000000000c1', 'approved', 'form', 'not_required', now(), 'b4600000-0000-0000-0000-0000000000a1',
   'organizer', 'VIP-WEWN-1 znajomy prezesa', NULL, NULL, NULL, NULL,
   encode(extensions.digest(rpad('b4pr-r1', 32, 'x'), 'sha256'), 'hex'), '{"first_name":"Ula"}'::jsonb),
  ('b4640000-0000-0000-0000-000000000002', 'b46a0000-0000-0000-0000-0000000000aa', 'b4610000-0000-0000-0000-000000000002',
   'b4630000-0000-0000-0000-0000000000c1', 'rejected', 'form', 'not_required', now(), 'b4600000-0000-0000-0000-0000000000a1',
   'organizer', 'PODEJRZANE-WEWN-2 konkurencja', 'Brak miejsc w tej puli.', NULL, NULL, NULL, NULL, NULL),
  ('b4640000-0000-0000-0000-000000000003', 'b46a0000-0000-0000-0000-0000000000aa', 'b4610000-0000-0000-0000-000000000003',
   'b4630000-0000-0000-0000-0000000000c1', 'cancelled', 'form', 'not_required', now(), 'b4600000-0000-0000-0000-0000000000a1',
   'organizer', 'WEWN-3 nie placi faktur', NULL, now(), NULL, NULL, NULL, NULL),
  ('b4640000-0000-0000-0000-000000000004', 'b46a0000-0000-0000-0000-0000000000aa', 'b4610000-0000-0000-0000-000000000004',
   'b4630000-0000-0000-0000-0000000000c1', 'approved', 'form', 'not_required', now(), 'b4600000-0000-0000-0000-0000000000a1',
   'organizer', 'WEWN-4 przywrocony', 'STALE-R4 stary powod', NULL, NULL, NULL, NULL, NULL),
  ('b4640000-0000-0000-0000-000000000005', 'b46a0000-0000-0000-0000-0000000000aa', 'b4610000-0000-0000-0000-000000000005',
   'b4630000-0000-0000-0000-0000000000c1', 'pending', 'form', 'not_required', NULL, NULL,
   NULL, 'WEWN-5 sprawdzic', NULL, NULL, NULL, NULL, NULL, NULL),
  ('b4640000-0000-0000-0000-000000000006', 'b46a0000-0000-0000-0000-0000000000aa', 'b4610000-0000-0000-0000-000000000006',
   'b4630000-0000-0000-0000-0000000000c1', 'waitlist', 'form', 'not_required', now(), 'b4600000-0000-0000-0000-0000000000a1',
   'organizer', 'WEWN-6 na koncu kolejki', NULL, NULL, NULL, 1, NULL, NULL),
  ('b4640000-0000-0000-0000-000000000007', 'b46a0000-0000-0000-0000-0000000000aa', 'b4610000-0000-0000-0000-000000000007',
   'b4630000-0000-0000-0000-0000000000c1', 'attended', 'form', 'not_required', now(), 'b4600000-0000-0000-0000-0000000000a1',
   'organizer', 'WEWN-7 spoznil sie', NULL, NULL, now(), NULL, NULL, NULL),
  -- Partner spotkania (inna osoba) na wydarzeniu r1.
  ('b4640000-0000-0000-0000-0000000000c2', 'b46a0000-0000-0000-0000-0000000000aa', 'b4610000-0000-0000-0000-000000000001',
   'b4630000-0000-0000-0000-0000000000c2', 'approved', 'form', 'not_required', NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  -- r8 przyjete - anulowanie z powodem dokladnie 1000 znakow.
  ('b4640000-0000-0000-0000-000000000008', 'b46a0000-0000-0000-0000-0000000000aa', 'b4610000-0000-0000-0000-000000000008',
   'b4630000-0000-0000-0000-0000000000c1', 'approved', 'form', 'not_required', NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

-- REG-16 (D8) w „Moich zgloszeniach": nieoplacone zgloszenie z oferta z chwili
-- zapisu (5000 PLN, wazna) na bilet, ktory dzis kosztuje 10000 PLN.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode)
VALUES ('b4610000-0000-0000-0000-000000000009', 'b46a0000-0000-0000-0000-0000000000aa', 'b4pr-9',
        'B4 cena', 'B4 price', now() + interval '30 days', 'published', 'form');
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency)
VALUES ('b4620000-0000-0000-0000-000000000009', 'b46a0000-0000-0000-0000-0000000000aa',
        'b4610000-0000-0000-0000-000000000009', 'b4pr_9', 'Wstep', 'Admission', 10000, 'PLN');
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
   quoted_price_cents, quoted_currency, quote_valid_until)
VALUES ('b4640000-0000-0000-0000-000000000009', 'b46a0000-0000-0000-0000-0000000000aa',
        'b4610000-0000-0000-0000-000000000009', 'b4630000-0000-0000-0000-0000000000c1',
        'b4620000-0000-0000-0000-000000000009', 'pending', 'form', 'unpaid',
        5000, 'PLN', now() + interval '2 days');

-- Spotkanie uczestnika (r1) z partnerem. Walidacja reguł spotkan (okna,
-- ustawienia wydarzenia) nie jest tu przedmiotem testu.
ALTER TABLE public.event_meetings DISABLE TRIGGER event_meetings_validate;
INSERT INTO public.event_meetings (id, tenant_id, event_id, requester_registration_id, invitee_registration_id,
                                   starts_at, ends_at, expires_at, status)
VALUES ('b4650000-0000-0000-0000-000000000001', 'b46a0000-0000-0000-0000-0000000000aa',
        'b4610000-0000-0000-0000-000000000001', 'b4640000-0000-0000-0000-0000000000c2',
        'b4640000-0000-0000-0000-000000000001', now() + interval '30 days 2 hours',
        now() + interval '30 days 2 hours 30 minutes', now() + interval '29 days', 'invited');
ALTER TABLE public.event_meetings ENABLE TRIGGER event_meetings_validate;

-- ── 1-6. Granty kolumnowe (D10) ────────────────────────────────────────────────
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.event_registrations', 'decision_note', 'SELECT'),
  'authenticated NIE czyta event_registrations.decision_note');
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.event_registrations', 'submitted_profile', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.event_registrations', 'manage_token_hash', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.event_registrations', 'qr_token_hash', 'SELECT'),
  'authenticated NIE czyta submitted_profile, manage_token_hash ani qr_token_hash');
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.event_people', 'notes', 'SELECT')
  AND NOT has_column_privilege('anon', 'public.event_people', 'notes', 'SELECT')
  AND NOT has_column_privilege('anon', 'public.event_registrations', 'decision_note', 'SELECT'),
  'notatka o osobie (event_people.notes) i decision_note niedostepne dla klienta');
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.event_registrations', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.event_people', 'SELECT'),
  'brak SELECT tabelowego - grant tabelowy obejmowalby kazda kolumne');
SELECT ok(
  (SELECT bool_and(has_column_privilege('authenticated', 'public.event_registrations', c, 'SELECT'))
     FROM unnest(ARRAY['id', 'tenant_id', 'event_id', 'person_id', 'status', 'payment_status',
                       'ticket_code_sent_at', 'ticket_code_undeliverable_at', 'participant_reason',
                       'waitlist_position', 'decision_source']) c)
  AND (SELECT bool_and(has_column_privilege('authenticated', 'public.event_people', c, 'SELECT'))
         FROM unnest(ARRAY['id', 'tenant_id', 'user_id', 'email', 'first_name']) c),
  'kolumny polityk RLS i odczytow klienta zostaja czytelne');
ALTER TABLE public.event_registrations ADD COLUMN b4pr_probe text;
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.event_registrations', 'b4pr_probe', 'SELECT'),
  'kolumna dodana PO migracji jest prywatna, dopoki jej migracja nie nada grantu');
ALTER TABLE public.event_registrations DROP COLUMN b4pr_probe;

-- ── 7-11. Bezposredni odczyt tabeli przez uczestnika (PostgREST) ─────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b4600000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT decision_note FROM public.event_registrations$$,
  '42501', NULL, 'GET /rest/v1/event_registrations?select=decision_note -> odmowa uprawnien');
SELECT throws_ok(
  $$SELECT notes FROM public.event_people$$,
  '42501', NULL, 'GET /rest/v1/event_people?select=notes -> odmowa uprawnien');
SELECT is(
  (SELECT count(*)::int FROM (SELECT id, status, payment_status FROM public.event_registrations) x),
  9, 'uczestnik nadal czyta WLASNE zgloszenia w kolumnach jawnych (polityka self_read)');
SELECT is(
  (SELECT count(*)::int FROM public.event_meetings WHERE id = 'b4650000-0000-0000-0000-000000000001'),
  1, 'polityka spotkan (podzapytanie do event_registrations) dziala: uczestnik widzi swoje spotkanie');
SELECT is(
  (SELECT count(*)::int FROM (SELECT id, email FROM public.event_people) x),
  1, 'uczestnik czyta swoja kartoteke w kolumnach jawnych');

-- ── 12-18. KRYTERIUM: „Moje zgloszenia" bez notatki wewnetrznej ─────────────────
CREATE TEMP TABLE b4pr_my ON COMMIT DROP AS
SELECT public.event_my_registrations('{"limit":50}'::jsonb) AS v;
RESET ROLE;
SELECT is(
  (SELECT jsonb_array_length(v->'registrations') FROM b4pr_my), 9,
  'event_my_registrations zwraca wszystkie zgloszenia uczestnika (kazdy status)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM b4pr_my, jsonb_array_elements(v->'registrations') e
               WHERE e ? 'decision_note' OR e ? 'cancel_reason'),
  'REG-06 KRYTERIUM: zaden wiersz nie ma klucza decision_note ani cancel_reason');
SELECT ok(
  (SELECT strpos(v::text, 'WEWN') = 0 AND strpos(v::text, 'VIP') = 0 FROM b4pr_my),
  'REG-06 KRYTERIUM: tresc zadnej notatki wewnetrznej (approved, rejected, cancelled, pending, waitlist, attended) nie wychodzi');
SELECT is(
  (SELECT e->>'participant_reason' FROM b4pr_my, jsonb_array_elements(v->'registrations') e
    WHERE e->>'registration_id' = 'b4640000-0000-0000-0000-000000000002'),
  'Brak miejsc w tej puli.', 'odrzucone: uczestnik widzi powod przeznaczony dla niego');
SELECT ok(
  (SELECT e ? 'participant_reason' AND e->'participant_reason' = 'null'::jsonb
     FROM b4pr_my, jsonb_array_elements(v->'registrations') e
    WHERE e->>'registration_id' = 'b4640000-0000-0000-0000-000000000004')
  AND (SELECT strpos(v::text, 'STALE-R4') = 0 FROM b4pr_my),
  'przyjete z nieaktualnym powodem: powod NIE wraca (tylko rejected/cancelled)');
SELECT ok(
  (SELECT e->'participant_reason' = 'null'::jsonb
     FROM b4pr_my, jsonb_array_elements(v->'registrations') e
    WHERE e->>'registration_id' = 'b4640000-0000-0000-0000-000000000003'),
  'anulowane bez powodu: brak powodu (notatka wewnetrzna nie zastepuje powodu)');
SELECT ok(
  (SELECT strpos(v::text, 'OSOBA-WEWN') = 0 FROM b4pr_my),
  'notatka o osobie nie wychodzi w „Moich zgloszeniach"');
SELECT is(
  (SELECT (e->>'amount_cents')::int FROM b4pr_my, jsonb_array_elements(v->'registrations') e
    WHERE e->>'registration_id' = 'b4640000-0000-0000-0000-000000000009'),
  5000, 'REG-16: kwota nieoplaconego to cena z chwili zapisu (_event_registration_unit_price), nie goly cennik');

-- ── 19-23. Dane do maila ──────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b4600000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT v->>'participant_reason' = 'Brak miejsc w tej puli.' AND NOT v ? 'decision_note'
          AND strpos(v::text, 'PODEJRZANE') = 0
     FROM (SELECT public.admin_event_registration_notify_payload(
             '{"registration_id":"b4640000-0000-0000-0000-000000000002"}'::jsonb) AS v) x),
  'mail o odrzuceniu: powod dla uczestnika, bez notatki wewnetrznej');
SELECT ok(
  (SELECT v->'participant_reason' = 'null'::jsonb AND strpos(v::text, 'VIP') = 0
     FROM (SELECT public.admin_event_registration_notify_payload(
             '{"registration_id":"b4640000-0000-0000-0000-000000000001"}'::jsonb) AS v) x),
  'mail o przyjeciu: bez powodu i bez notatki wewnetrznej');
SELECT ok(
  (SELECT v->'participant_reason' = 'null'::jsonb AND strpos(v::text, 'STALE-R4') = 0
     FROM (SELECT public.admin_event_registration_notify_payload(
             '{"registration_id":"b4640000-0000-0000-0000-000000000004"}'::jsonb) AS v) x),
  'mail dla ponownie przyjetego: stary powod nie wraca');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT ok(
  (SELECT NOT v ? 'decision_note' AND strpos(v::text, 'VIP') = 0 AND v->>'first_name' = 'Ula'
     FROM (SELECT public.event_registration_notify_payload_for_tenant(
             'b46a0000-0000-0000-0000-0000000000aa',
             jsonb_build_object('manage_token', rpad('b4pr-r1', 32, 'x'))) AS v) x),
  'dane do maila po kluczu samoobslugi: bez notatki wewnetrznej');
RESET ROLE;
SELECT ok(
  (SELECT bool_and(strpos(pg_get_functiondef(f::regprocedure), 'decision_note') = 0)
     FROM unnest(ARRAY['public.event_my_registrations(jsonb)',
                       'public.admin_event_registration_notify_payload(jsonb)',
                       'public.event_registration_notify_payload_for_tenant(uuid,jsonb)',
                       'public.event_registration_cancel_preview(jsonb)',
                       'public.event_registration_manage_view(jsonb)']) f),
  'straznik katalogu: zadna funkcja uczestnika ani maila nie wspomina decision_note (ponowne nalozenie starego pliku = czerwony test)');

-- ── 24-36. Decyzja organizatora: dwa pola, limity jako odmowa ─────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b4600000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4640000-0000-0000-0000-000000000005',
    'action', 'approve', 'participant_reason', 'Witamy'))$$,
  'invalid_request%', 'participant_reason tylko dla reject/cancel/refund (approve -> invalid_request)');
SELECT throws_like(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4640000-0000-0000-0000-000000000005',
    'action', 'waitlist', 'participant_reason', 'Kolejka'))$$,
  'invalid_request%', 'participant_reason tylko dla reject/cancel/refund (waitlist -> invalid_request)');
SELECT throws_like(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4640000-0000-0000-0000-000000000005',
    'action', 'reject', 'note', 'Powod wewnetrzny', 'participant_reason', repeat('x', 1001)))$$,
  'participant_reason_too_long%', 'powod dla uczestnika > 1000 znakow -> odmowa (nie przyciecie)');
SELECT throws_like(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4640000-0000-0000-0000-000000000005',
    'action', 'reject', 'note', repeat('n', 2001)))$$,
  'note_too_long%', 'notatka wewnetrzna > 2000 znakow -> odmowa note_too_long (nie 23514)');
SELECT throws_like(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4640000-0000-0000-0000-000000000005',
    'action', 'reject', 'participant_reason', 'Tylko dla uczestnika'))$$,
  'reason_required%', 'odrzucenie nadal wymaga notatki wewnetrznej (powod dla uczestnika jej nie zastepuje)');
SELECT is(
  public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4640000-0000-0000-0000-000000000005',
    'action', 'reject', 'note', 'INTERNAL-X weryfikacja negatywna', 'participant_reason', '  Widoczny-Y  ')) ->> 'participant_reason',
  'Widoczny-Y', 'odrzucenie z dwoma polami: odpowiedz organizatora z powodem (przyciete spacje)');
SELECT lives_ok(
  format($$SELECT public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4640000-0000-0000-0000-000000000008',
    'action', 'cancel', 'participant_reason', %L))$$, repeat('z', 1000)),
  'powod dokladnie 1000 znakow przechodzi');
RESET ROLE;
SELECT ok(
  (SELECT decision_note = 'INTERNAL-X weryfikacja negatywna' AND participant_reason = 'Widoczny-Y'
     FROM public.event_registrations WHERE id = 'b4640000-0000-0000-0000-000000000005'),
  'odrzucenie zapisuje notatke wewnetrzna i powod dla uczestnika osobno');
SELECT is(
  (SELECT char_length(participant_reason) FROM public.event_registrations WHERE id = 'b4640000-0000-0000-0000-000000000008'),
  1000, 'powod zapisany w calosci (bez urwania)');

SELECT set_config('request.jwt.claims',
  '{"sub":"b4600000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT strpos(v::text, 'Widoczny-Y') > 0 AND strpos(v::text, 'INTERNAL-X') = 0
     FROM (SELECT public.event_my_registrations('{"limit":50}'::jsonb) AS v) x),
  'uczestnik widzi powod dla siebie, nie widzi notatki wewnetrznej z tej samej decyzji');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  '{"sub":"b4600000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4640000-0000-0000-0000-000000000005',
    'action', 'approve'))$$,
  'ponowne przyjecie odrzuconego');
RESET ROLE;
SELECT ok(
  (SELECT participant_reason IS NULL AND decision_note = 'INTERNAL-X weryfikacja negatywna'
     FROM public.event_registrations WHERE id = 'b4640000-0000-0000-0000-000000000005'),
  'nowa decyzja czysci powod zamkniecia, notatka wewnetrzna zostaje w historii');
SELECT ok(
  (SELECT participant_reason IS NULL FROM public.event_registrations
    WHERE id = 'b4640000-0000-0000-0000-0000000000c2'),
  'bez backfillu: powod nie powstaje z notatki wewnetrznej');

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
