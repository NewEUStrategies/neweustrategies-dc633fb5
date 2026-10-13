-- pgTAP: klucz samoobslugi (manage_token) - jedna regula we wszystkich
-- odbiorcach (REG-17, migracja 20261012160000_event_manage_token_hygiene).
--
-- KRYTERIUM AUDYTU REG-17: „odmowa klucza po ends_at". Klucz zgloszenia
-- wydarzenia, ktore sie skonczylo (ends_at w przeszlosci; bez ends_at -
-- starts_at + 24 h), jest odrzucany przez KAZDA funkcje, ktora go przyjmuje:
--   * `event_registration_manage_view`         -> {ok:false, reason:'expired'}
--   * `event_registration_attribution_attach`  -> {ok:false, reason:'expired'}
--   * `event_ticket_seats` (galaz klucza)      -> pusta lista
--   * `event_registration_notify_payload(_for_tenant)` -> manage_expired
--   * `_event_registration_actor`              -> klucz nie czyni posiadaczem
--   * kontrola krzyzowa: `event_registration_cancel` (B4)
--     i `event_registration_set_channels` (B5) -> manage_expired.
-- Klucz zgloszenia anulowanego: podglad statusu dziala, kazda akcja nie.
--
-- Plus: ACL (obwodka `event_registration_notify_payload` bez anon
-- i authenticated), kwota w podgladzie z oferty z chwili zapisu na granicy
-- early birda (REG-16), brak danych osobowych w podgladzie, obcy najemca.
--
-- now() jest stale w transakcji, wiec granice czasu sa dokladne.
BEGIN;
SELECT plan(43);

ALTER TABLE auth.users DISABLE TRIGGER USER;
-- Przydzial miejsca w fixture bez walidacji (stan zgloszenia, blokady sali) -
-- ten plik pyta o klucz, nie o reguly sali.
ALTER TABLE public.event_seat_assignments DISABLE TRIGGER USER;
ALTER TABLE public.event_seats DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b70a0000-0000-0000-0000-0000000000aa', 'b7h-a', 'B7 Manage Hygiene A', 'b7h-a.example'),
  ('b70b0000-0000-0000-0000-0000000000bb', 'b7h-b', 'B7 Manage Hygiene B', 'b7h-b.example');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status, registration_mode) VALUES
  ('b7100000-0000-0000-0000-000000000001', 'b70a0000-0000-0000-0000-0000000000aa', 'b7h-future',
   'B7 przyszle', 'B7 future', now() + interval '30 days', NULL, 'published', 'form'),
  ('b7100000-0000-0000-0000-000000000002', 'b70a0000-0000-0000-0000-0000000000aa', 'b7h-ended',
   'B7 zakonczone', 'B7 ended', now() - interval '2 days', now() - interval '1 minute', 'published', 'form'),
  ('b7100000-0000-0000-0000-000000000003', 'b70a0000-0000-0000-0000-0000000000aa', 'b7h-noend-24',
   'B7 bez konca 24h', 'B7 no end 24h', now() - interval '24 hours 1 second', NULL, 'published', 'form'),
  ('b7100000-0000-0000-0000-000000000004', 'b70a0000-0000-0000-0000-0000000000aa', 'b7h-noend-23',
   'B7 bez konca 23h', 'B7 no end 23h', now() - interval '23 hours', NULL, 'published', 'form'),
  ('b7100000-0000-0000-0000-0000000000b1', 'b70b0000-0000-0000-0000-0000000000bb', 'b7h-b',
   'B7 najemca B', 'B7 tenant B', now() + interval '30 days', NULL, 'published', 'form');

-- Bilet platny, early bird 5000 skonczyl sie SEKUNDE temu - cena biezaca 10000.
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   early_bird_price_cents, early_bird_until) VALUES
  ('b7200000-0000-0000-0000-000000000001', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000001', 'b7h_paid', 'Platny', 'Paid', 10000, 'PLN',
   5000, now() - interval '1 second');

INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name) VALUES
  ('b7300000-0000-0000-0000-000000000001', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7h-guest@example.org', 'Gosc', 'Nazwiskowy'),
  ('b7300000-0000-0000-0000-000000000002', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7h-quote@example.org', 'Oferta', 'Wazna'),
  ('b7300000-0000-0000-0000-000000000003', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7h-quote-old@example.org', 'Oferta', 'Wygasla'),
  ('b7300000-0000-0000-0000-0000000000b1', 'b70b0000-0000-0000-0000-0000000000bb',
   'b7h-guest@example.org', 'Gosc B', 'Nazwiskowy B');

-- Klucze: 32 znaki base64url (rpad), w bazie tylko sha256 hex - jak w produkcji.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, cancelled_at, manage_token_hash) VALUES
  ('b7400000-0000-0000-0000-000000000001', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000001', 'b7300000-0000-0000-0000-000000000001', 'approved', 'form', NULL,
   encode(extensions.digest(rpad('b7h-ok', 32, 'x'), 'sha256'), 'hex')),
  ('b7400000-0000-0000-0000-000000000002', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000001', 'b7300000-0000-0000-0000-000000000001', 'cancelled', 'form', now(),
   encode(extensions.digest(rpad('b7h-cancel', 32, 'x'), 'sha256'), 'hex')),
  ('b7400000-0000-0000-0000-000000000003', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000002', 'b7300000-0000-0000-0000-000000000001', 'approved', 'form', NULL,
   encode(extensions.digest(rpad('b7h-ended', 32, 'x'), 'sha256'), 'hex')),
  ('b7400000-0000-0000-0000-000000000004', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000003', 'b7300000-0000-0000-0000-000000000001', 'approved', 'form', NULL,
   encode(extensions.digest(rpad('b7h-noend-24', 32, 'x'), 'sha256'), 'hex')),
  ('b7400000-0000-0000-0000-000000000005', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000004', 'b7300000-0000-0000-0000-000000000001', 'approved', 'form', NULL,
   encode(extensions.digest(rpad('b7h-noend-23', 32, 'x'), 'sha256'), 'hex')),
  ('b7400000-0000-0000-0000-0000000000b1', 'b70b0000-0000-0000-0000-0000000000bb',
   'b7100000-0000-0000-0000-0000000000b1', 'b7300000-0000-0000-0000-0000000000b1', 'approved', 'form', NULL,
   encode(extensions.digest(rpad('b7h-b', 32, 'x'), 'sha256'), 'hex'));

-- Nieoplacone zgloszenia na bilet platny: oferta early bird 5000 wazna godzine
-- (granica early birda) i oferta, ktora wygasla sekunde temu.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
   quoted_price_cents, quoted_currency, quote_valid_until, manage_token_hash) VALUES
  ('b7400000-0000-0000-0000-0000000000c1', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000001', 'b7300000-0000-0000-0000-000000000002',
   'b7200000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid',
   5000, 'PLN', now() + interval '1 hour',
   encode(extensions.digest(rpad('b7h-quote', 32, 'x'), 'sha256'), 'hex')),
  ('b7400000-0000-0000-0000-0000000000c2', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000001', 'b7300000-0000-0000-0000-000000000003',
   'b7200000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid',
   5000, 'PLN', now() - interval '1 second',
   encode(extensions.digest(rpad('b7h-quote-old', 32, 'x'), 'sha256'), 'hex'));

-- Sala: opublikowany plan na wydarzeniu przyszlym i na zakonczonym, po jednym
-- miejscu przydzielonym zgloszeniom 'ok' i 'ended'.
INSERT INTO public.event_seat_maps (id, tenant_id, event_id, name, status, published_at) VALUES
  ('b7500000-0000-0000-0000-000000000001', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000001', 'Sala przyszla', 'published', now()),
  ('b7500000-0000-0000-0000-000000000002', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000002', 'Sala zakonczona', 'published', now());
INSERT INTO public.event_seat_sections
  (id, tenant_id, event_id, map_id, label, kind, rows_count, seats_per_row, row_label_scheme, seat_numbering) VALUES
  ('b7510000-0000-0000-0000-000000000001', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000001', 'b7500000-0000-0000-0000-000000000001', 'Parter', 'rows', 1, 1, 'alpha', 'ltr'),
  ('b7510000-0000-0000-0000-000000000002', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000002', 'b7500000-0000-0000-0000-000000000002', 'Parter', 'rows', 1, 1, 'alpha', 'ltr');
INSERT INTO public.event_seats (id, tenant_id, event_id, map_id, section_id, row_label, seat_number, x, y, sort_key) VALUES
  ('b7520000-0000-0000-0000-000000000001', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000001', 'b7500000-0000-0000-0000-000000000001',
   'b7510000-0000-0000-0000-000000000001', 'A', 1, 10, 10, 1),
  ('b7520000-0000-0000-0000-000000000002', 'b70a0000-0000-0000-0000-0000000000aa',
   'b7100000-0000-0000-0000-000000000002', 'b7500000-0000-0000-0000-000000000002',
   'b7510000-0000-0000-0000-000000000002', 'A', 1, 10, 10, 1);
INSERT INTO public.event_seat_assignments
  (tenant_id, event_id, map_id, seat_id, registration_id, seat_label_snapshot) VALUES
  ('b70a0000-0000-0000-0000-0000000000aa', 'b7100000-0000-0000-0000-000000000001',
   'b7500000-0000-0000-0000-000000000001', 'b7520000-0000-0000-0000-000000000001',
   'b7400000-0000-0000-0000-000000000001', 'A1'),
  ('b70a0000-0000-0000-0000-0000000000aa', 'b7100000-0000-0000-0000-000000000002',
   'b7500000-0000-0000-0000-000000000002', 'b7520000-0000-0000-0000-000000000002',
   'b7400000-0000-0000-0000-000000000003', 'A1');

-- Klucz z fixture po etykiecie.
CREATE FUNCTION pg_temp.k(_label text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT rpad('b7h-' || _label, 32, 'x') $$;

-- ---------------------------------------------------------------------------
-- 1. ACL
-- ---------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege('anon', 'public.event_registration_notify_payload(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_registration_notify_payload(jsonb)', 'EXECUTE'),
  'notify_payload: obwodka BEZ EXECUTE dla anon i authenticated (dane kontaktowe tylko dla serwera)');
SELECT ok(has_function_privilege('service_role', 'public.event_registration_notify_payload(jsonb)', 'EXECUTE'),
  'notify_payload: service_role (okno wdrozenia serwera)');
SELECT ok(NOT has_function_privilege('anon', 'public.event_registration_notify_payload_for_tenant(uuid, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_registration_notify_payload_for_tenant(uuid, jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_registration_notify_payload_for_tenant(uuid, jsonb)', 'EXECUTE'),
  'notify_payload_for_tenant: tylko service_role');
SELECT ok(NOT has_function_privilege('anon', 'public._event_registration_actor(uuid, uuid, uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_registration_actor(uuid, uuid, uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_registration_actor(uuid, uuid, uuid, text)', 'EXECUTE'),
  '_event_registration_actor: tylko service_role');
SELECT ok(has_function_privilege('anon', 'public.event_registration_manage_view(jsonb)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.event_registration_attribution_attach(jsonb)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.event_ticket_seats(jsonb)', 'EXECUTE'),
  'podglad, atrybucja i miejsce: nadal publiczne (kluczem jest sam klucz)');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN ('event_registration_manage_view', 'event_registration_attribution_attach',
                                'event_ticket_seats', '_event_registration_actor')
              AND obj_description(p.oid, 'pg_proc') LIKE '%_event_manage_token_resolve%'), 4,
  'COMMENT: kazdy odbiorca klucza nazywa jedna regule (_event_manage_token_resolve)');

-- ---------------------------------------------------------------------------
-- 2. Podglad statusu (anon, host najemcy A)
-- ---------------------------------------------------------------------------
SELECT set_config('request.headers', '{"x-tenant-host":"b7h-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;

SELECT is(public.event_registration_manage_view(jsonb_build_object('manage_token', pg_temp.k('ok')))->>'status',
  'approved', 'podglad: wazny klucz -> status zgloszenia');
SELECT is(public.event_registration_manage_view(jsonb_build_object('manage_token', pg_temp.k('cancel')))->>'status',
  'cancelled', 'podglad: klucz zgloszenia ANULOWANEGO nadal pokazuje status (cel view)');
SELECT is(public.event_registration_manage_view(jsonb_build_object('manage_token', pg_temp.k('ended'))),
  '{"ok": false, "reason": "expired"}'::jsonb,
  'podglad: REG-17 odmowa klucza po ends_at -> {ok:false, reason:expired}');
SELECT is(public.event_registration_manage_view(jsonb_build_object('manage_token', pg_temp.k('noend-24'))),
  '{"ok": false, "reason": "expired"}'::jsonb,
  'podglad: bez ends_at klucz wygasa po starts_at + 24 h');
SELECT is(public.event_registration_manage_view(jsonb_build_object('manage_token', pg_temp.k('noend-23')))->>'ok',
  'true', 'podglad: bez ends_at, 23 h po starcie - klucz jeszcze wazny');
SELECT is(public.event_registration_manage_view(jsonb_build_object('manage_token', pg_temp.k('b'))),
  '{"ok": false, "reason": "not_found"}'::jsonb,
  'podglad: klucz OBCEGO najemcy -> not_found (bez rozroznienia od nieznanego)');
SELECT is(public.event_registration_manage_view(jsonb_build_object('manage_token', pg_temp.k('nie-ma'))),
  '{"ok": false, "reason": "not_found"}'::jsonb,
  'podglad: nieznany klucz -> not_found jak dotad');
SELECT ok((SELECT bool_and(k IN ('ok', 'registration_id', 'event_id', 'event_slug', 'ticket_type_id', 'status',
                                  'payment_status', 'waitlist_position', 'amount_cents', 'price_source',
                                  'quote_valid_until', 'currency', 'owned_by_caller'))
             FROM jsonb_object_keys(public.event_registration_manage_view(
                    jsonb_build_object('manage_token', pg_temp.k('ok')))) k),
  'podglad: wylacznie stan i kwota - zadnego adresu, imienia ani nazwiska');
-- REG-16 przy granicy early birda: oferta z chwili zapisu (5000) wygrywa
-- z cena biezaca (10000), dopoki jest wazna.
SELECT is(public.event_registration_manage_view(jsonb_build_object('manage_token', pg_temp.k('quote')))->>'amount_cents',
  '5000', 'podglad: kwota z oferty z chwili zapisu (early bird) mimo konca early birda');
SELECT is(public.event_registration_manage_view(jsonb_build_object('manage_token', pg_temp.k('quote')))->>'price_source',
  'quote', 'podglad: price_source = quote');
SELECT is((public.event_registration_manage_view(jsonb_build_object('manage_token', pg_temp.k('quote')))->>'quote_valid_until')::timestamptz,
  now() + interval '1 hour', 'podglad: quote_valid_until = termin oferty');
SELECT is(public.event_registration_manage_view(jsonb_build_object('manage_token', pg_temp.k('quote-old')))->>'amount_cents',
  '10000', 'podglad: oferta wygasla -> cena biezaca');
SELECT is(public.event_registration_manage_view(jsonb_build_object('manage_token', pg_temp.k('quote-old')))->>'price_source',
  'current', 'podglad: oferta wygasla -> price_source = current');

-- ---------------------------------------------------------------------------
-- 3. Przypiecie atrybucji (anon)
-- ---------------------------------------------------------------------------
SELECT is(public.event_registration_attribution_attach(jsonb_build_object('manage_token', pg_temp.k('ended'))),
  '{"ok": false, "reason": "expired"}'::jsonb,
  'atrybucja: REG-17 odmowa klucza po ends_at (mimo doby od zapisu)');
SELECT is(public.event_registration_attribution_attach(jsonb_build_object('manage_token', pg_temp.k('cancel'))),
  '{"ok": false, "reason": "closed"}'::jsonb,
  'atrybucja: klucz zgloszenia anulowanego nie przypina niczego');
SELECT is(public.event_registration_attribution_attach(jsonb_build_object('manage_token', pg_temp.k('nie-ma'))),
  '{"ok": false, "reason": "not_found"}'::jsonb,
  'atrybucja: nieznany klucz -> not_found');
SELECT is(public.event_registration_attribution_attach(jsonb_build_object('manage_token', pg_temp.k('ok')))->>'attached',
  'true', 'atrybucja: wazny klucz w dobie od zapisu przypina kampanie');

-- ---------------------------------------------------------------------------
-- 4. Miejsce na sali na stronie biletu (anon)
-- ---------------------------------------------------------------------------
SELECT is(jsonb_array_length(public.event_ticket_seats(jsonb_build_object(
    'slug', 'b7h-future', 'manage_token', pg_temp.k('ok')))->'seats'), 1,
  'miejsca: wazny klucz -> karta miejsca');
SELECT is(public.event_ticket_seats(jsonb_build_object('slug', 'b7h-ended', 'manage_token', pg_temp.k('ended'))),
  '{"seats": []}'::jsonb, 'miejsca: REG-17 odmowa klucza po ends_at -> pusta lista');
SELECT is(public.event_ticket_seats(jsonb_build_object('slug', 'b7h-ended', 'manage_token', pg_temp.k('ok'))),
  '{"seats": []}'::jsonb, 'miejsca: klucz z innego wydarzenia niz slug strony -> pusta lista');

-- ---------------------------------------------------------------------------
-- 5. Kontrola krzyzowa: akcje kluczem (B4 rezygnacja, B5 kanaly)
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  format('SELECT public.event_registration_cancel(%L::jsonb)', jsonb_build_object('manage_token', pg_temp.k('ended'))),
  'P0001', 'manage_expired: this management link expired when the event ended',
  'rezygnacja: klucz po ends_at -> manage_expired');
SELECT throws_ok(
  format('SELECT public.event_registration_set_channels(%L::jsonb)',
         jsonb_build_object('manage_token', pg_temp.k('ended'), 'remind_email', false)),
  'P0001', 'manage_expired: this management link expired when the event ended',
  'kanaly: klucz po ends_at -> manage_expired');
SELECT throws_ok(
  format('SELECT public.event_registration_cancel(%L::jsonb)', jsonb_build_object('manage_token', pg_temp.k('cancel'))),
  'P0001', 'already_closed: this registration is already closed',
  'rezygnacja: klucz zgloszenia anulowanego -> already_closed');
SELECT throws_ok(
  format('SELECT public.event_registration_set_channels(%L::jsonb)',
         jsonb_build_object('manage_token', pg_temp.k('cancel'), 'remind_email', false)),
  'P0001', 'already_closed: this registration is already closed',
  'kanaly: klucz zgloszenia anulowanego -> already_closed');
SELECT throws_ok(
  format('SELECT public.event_registration_notify_payload(%L::jsonb)', jsonb_build_object('manage_token', pg_temp.k('ok'))),
  '42501', NULL, 'notify_payload: anon nie wywola obwodki (permission denied)');
RESET ROLE;

-- Przypiecie zgloszenia po ends_at nie zostawilo wiersza; wazne - zostawilo.
SELECT is((SELECT count(*)::int FROM public.event_registration_attributions
            WHERE registration_id = 'b7400000-0000-0000-0000-000000000003'), 0,
  'atrybucja: po odmowie klucza po ends_at brak wiersza atrybucji');
SELECT is((SELECT count(*)::int FROM public.event_registration_attributions
            WHERE registration_id = 'b7400000-0000-0000-0000-000000000001'), 1,
  'atrybucja: wazny klucz zostawil dokladnie jeden wiersz');

-- ---------------------------------------------------------------------------
-- 6. Dane do maila i aktor (service_role)
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;

SELECT is(public.event_registration_notify_payload(jsonb_build_object('manage_token', pg_temp.k('ok')))->>'email',
  'b7h-guest@example.org', 'notify_payload: obwodka oddaje adres serwerowi (najemca z hosta)');
SELECT ok(NOT (public.event_registration_notify_payload(jsonb_build_object('manage_token', pg_temp.k('ok'))) ? 'last_name'),
  'notify_payload: obwodka bez nazwiska (ksztalt _for_tenant)');
SELECT throws_ok(
  format('SELECT public.event_registration_notify_payload(%L::jsonb)', jsonb_build_object('manage_token', pg_temp.k('ended'))),
  'P0001', 'manage_expired: this management link expired when the event ended',
  'notify_payload: REG-17 odmowa klucza po ends_at');
SELECT throws_ok(
  format('SELECT public.event_registration_notify_payload_for_tenant(%L, %L::jsonb)',
         'b70a0000-0000-0000-0000-0000000000aa', jsonb_build_object('manage_token', pg_temp.k('ended'))),
  'P0001', 'manage_expired: this management link expired when the event ended',
  'notify_payload_for_tenant: REG-17 odmowa klucza po ends_at');
SELECT throws_ok(
  format('SELECT public.event_registration_notify_payload(%L::jsonb)', jsonb_build_object('manage_token', pg_temp.k('cancel'))),
  'P0001', 'not_found: registration does not exist',
  'notify_payload: klucz zgloszenia anulowanego nie oddaje adresu');

SELECT is(public._event_registration_actor('b70a0000-0000-0000-0000-0000000000aa', NULL, NULL, pg_temp.k('ok'))
            - ARRAY['registration_id', 'tenant_id', 'event_id', 'person_id', 'ticket_type_id', 'status',
                    'payment_status', 'source', 'group_lead_registration_id', 'is_group', 'is_registrant',
                    'is_payer', 'holder_user_id', 'payer_user_id', 'payment_order_id'],
  '{"exists": true, "via_token": true, "is_holder": true, "token_verdict": "ok"}'::jsonb,
  'aktor: wazny klucz -> posiadacz przez klucz');
SELECT is(public._event_registration_actor('b70a0000-0000-0000-0000-0000000000aa', NULL, NULL, pg_temp.k('ended'))
            - ARRAY['registration_id', 'tenant_id', 'event_id', 'person_id', 'ticket_type_id', 'status',
                    'payment_status', 'source', 'group_lead_registration_id', 'is_group', 'is_registrant',
                    'is_payer', 'holder_user_id', 'payer_user_id', 'payment_order_id'],
  '{"exists": true, "via_token": false, "is_holder": false, "token_verdict": "expired"}'::jsonb,
  'aktor: REG-17 klucz po ends_at nie czyni posiadaczem (token_verdict expired)');
SELECT is(public._event_registration_actor('b70a0000-0000-0000-0000-0000000000aa', NULL, NULL, pg_temp.k('cancel'))->>'token_verdict',
  'closed', 'aktor: klucz zgloszenia anulowanego -> closed, bez posiadania');
SELECT is(public._event_registration_actor('b70a0000-0000-0000-0000-0000000000aa',
            'b7400000-0000-0000-0000-000000000001', NULL, pg_temp.k('quote'))
            - ARRAY['registration_id', 'tenant_id', 'event_id', 'person_id', 'ticket_type_id', 'status',
                    'payment_status', 'source', 'group_lead_registration_id', 'is_group', 'is_registrant',
                    'is_payer', 'holder_user_id', 'payer_user_id', 'payment_order_id'],
  '{"exists": true, "via_token": false, "is_holder": false, "token_verdict": "not_found"}'::jsonb,
  'aktor: klucz INNEGO zgloszenia nie dowodzi posiadania wskazanego');
SELECT is(public._event_registration_actor('b70b0000-0000-0000-0000-0000000000bb', NULL, NULL, pg_temp.k('ok')),
  '{"exists": false}'::jsonb, 'aktor: klucz w obcym najemcy -> exists false');
RESET ROLE;

SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
