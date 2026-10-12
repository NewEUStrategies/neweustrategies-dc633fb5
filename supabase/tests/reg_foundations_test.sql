-- pgTAP: fundamenty naprawy zapisow REG (migracja 20261012100000_reg_foundations).
--
-- PO CO TEN PLIK. Migracja stawia reguly, na ktorych stoja pozniejsze poprawki
-- serii REG: wiazanie konta tylko przez POTWIERDZONY adres (REG-01), jedna
-- regula klucza samoobslugi i dane do maila po najemcy z serwera (REG-17),
-- migawka ceny zgloszenia (REG-16). Kazda z tych regul jest tu przypieta
-- WPROST, zanim ktokolwiek zacznie ja wolac - blad w regule bylby inaczej
-- widoczny dopiero jako rozjazd w kilku funkcjach naraz.
--
-- CO PRZYPINA:
--   * ACL - kazda nowa funkcja bez EXECUTE dla anon i authenticated,
--     z EXECUTE dla service_role; COMMENT na kazdej;
--   * `_event_uid_owns_email` - tylko potwierdzony adres konta (wielkosc liter
--     i spacje bez znaczenia), nigdy NULL;
--   * `_event_bind_uid_for_email` - konto dowiazane do innej osoby najemcy
--     nie wiaze sie drugi raz, ta sama osoba to nie konflikt, wiazanie per
--     najemca;
--   * `_require_server_probe` - surowy adres, zly ksztalt, brak najemcy ->
--     invalid_payload;
--   * `_event_manage_token_resolve` - ksztalt, obcy najemca, wygasniecie
--     z koncem wydarzenia (takze bez ends_at: starts_at + 24 h), zamkniecie po
--     anulowaniu/odrzuceniu dla celow innych niz podglad;
--   * `event_registration_notify_payload_for_tenant` - dane tylko dla waznego,
--     otwartego klucza u TEGO najemcy, bez decision_note i last_name;
--   * `_event_registration_unit_price` i CHECK ksztaltu oferty - granica early
--     birda, LEAST, wygasla oferta, inna waluta, brak oferty, brak biletu.
--
-- now() jest stale w transakcji, wiec granice czasu sa dokladne co do
-- mikrosekundy (oferta wazna DO `now()` wlacznie, wydarzenie z koncem
-- `now() - 1 s` juz wygaslo).
BEGIN;
SELECT plan(80);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('a10a0000-0000-0000-0000-0000000000aa', 'regf-a', 'REG Foundations A', 'regf-a.example'),
  ('a10b0000-0000-0000-0000-0000000000bb', 'regf-b', 'REG Foundations B', 'regf-b.example');

-- owner: potwierdzony, niedowiazany; unconf: bez potwierdzenia (stub platformy
-- nie ma domyslnej wartosci - NULL jawnie, jak w harnessie); bound: potwierdzony,
-- dowiazany w A do osoby o INNYM adresie; same: dowiazany do osoby o SWOIM adresie.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a1000000-0000-0000-0000-0000000000a1', 'regf-owner@example.org', now()),
  ('a1000000-0000-0000-0000-0000000000a2', 'regf-unconf@example.org', NULL),
  ('a1000000-0000-0000-0000-0000000000a3', 'regf-bound@example.org', now()),
  ('a1000000-0000-0000-0000-0000000000a4', 'regf-same@example.org', now());

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status) VALUES
  ('a1100000-0000-0000-0000-0000000000e1', 'a10a0000-0000-0000-0000-0000000000aa',
   'regf-future', 'REGF przyszle', 'REGF future', now() + interval '10 days', NULL, 'published'),
  ('a1100000-0000-0000-0000-0000000000e2', 'a10a0000-0000-0000-0000-0000000000aa',
   'regf-ended', 'REGF zakonczone', 'REGF ended', now() - interval '2 days', now() - interval '1 minute', 'published'),
  ('a1100000-0000-0000-0000-0000000000e3', 'a10a0000-0000-0000-0000-0000000000aa',
   'regf-noend-24', 'REGF bez konca 24h', 'REGF no end 24h', now() - interval '24 hours 1 second', NULL, 'published'),
  ('a1100000-0000-0000-0000-0000000000e4', 'a10a0000-0000-0000-0000-0000000000aa',
   'regf-noend-23', 'REGF bez konca 23h', 'REGF no end 23h', now() - interval '23 hours', NULL, 'published'),
  ('a1100000-0000-0000-0000-0000000000e5', 'a10b0000-0000-0000-0000-0000000000bb',
   'regf-b-future', 'REGF B', 'REGF B', now() + interval '10 days', NULL, 'published');

-- Bilet platny z early birdem, ktory WLASNIE sie skonczyl: cena biezaca 10000.
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   early_bird_price_cents, early_bird_until) VALUES
  ('a1200000-0000-0000-0000-0000000000f1', 'a10a0000-0000-0000-0000-0000000000aa',
   'a1100000-0000-0000-0000-0000000000e1', 'regf_paid', 'Platny', 'Paid', 10000, 'PLN',
   5000, now() - interval '1 second');

INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name, user_id) VALUES
  ('a1300000-0000-0000-0000-000000000001', 'a10a0000-0000-0000-0000-0000000000aa',
   'regf-guest@example.org', 'Gosc', 'Nazwiskowy', NULL),
  ('a1300000-0000-0000-0000-000000000002', 'a10a0000-0000-0000-0000-0000000000aa',
   'regf-other@example.org', 'Inna', 'Osoba', 'a1000000-0000-0000-0000-0000000000a3'),
  ('a1300000-0000-0000-0000-000000000003', 'a10a0000-0000-0000-0000-0000000000aa',
   'regf-same@example.org', 'Ta', 'Sama', 'a1000000-0000-0000-0000-0000000000a4'),
  ('a1300000-0000-0000-0000-000000000005', 'a10a0000-0000-0000-0000-0000000000aa',
   'regf-price@example.org', 'Cena', 'Oferta', NULL),
  ('a1300000-0000-0000-0000-0000000000b1', 'a10b0000-0000-0000-0000-0000000000bb',
   'regf-guest@example.org', 'Gosc B', 'Nazwiskowy B', NULL);

-- Klucze: 32 znaki base64url (rpad), w bazie tylko sha256 hex - jak w produkcji.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, cancelled_at, manage_token_hash) VALUES
  ('a1400000-0000-0000-0000-000000000001', 'a10a0000-0000-0000-0000-0000000000aa',
   'a1100000-0000-0000-0000-0000000000e1', 'a1300000-0000-0000-0000-000000000001', 'approved', 'form', NULL,
   encode(extensions.digest(rpad('regf-ok', 32, 'x'), 'sha256'), 'hex')),
  ('a1400000-0000-0000-0000-000000000002', 'a10a0000-0000-0000-0000-0000000000aa',
   'a1100000-0000-0000-0000-0000000000e1', 'a1300000-0000-0000-0000-000000000001', 'cancelled', 'form', now(),
   encode(extensions.digest(rpad('regf-cancel', 32, 'x'), 'sha256'), 'hex')),
  ('a1400000-0000-0000-0000-000000000003', 'a10a0000-0000-0000-0000-0000000000aa',
   'a1100000-0000-0000-0000-0000000000e1', 'a1300000-0000-0000-0000-000000000001', 'rejected', 'form', NULL,
   encode(extensions.digest(rpad('regf-reject', 32, 'x'), 'sha256'), 'hex')),
  ('a1400000-0000-0000-0000-000000000004', 'a10a0000-0000-0000-0000-0000000000aa',
   'a1100000-0000-0000-0000-0000000000e2', 'a1300000-0000-0000-0000-000000000001', 'approved', 'form', NULL,
   encode(extensions.digest(rpad('regf-ended', 32, 'x'), 'sha256'), 'hex')),
  ('a1400000-0000-0000-0000-000000000005', 'a10a0000-0000-0000-0000-0000000000aa',
   'a1100000-0000-0000-0000-0000000000e2', 'a1300000-0000-0000-0000-000000000001', 'cancelled', 'form', now(),
   encode(extensions.digest(rpad('regf-ended-cx', 32, 'x'), 'sha256'), 'hex')),
  ('a1400000-0000-0000-0000-000000000006', 'a10a0000-0000-0000-0000-0000000000aa',
   'a1100000-0000-0000-0000-0000000000e3', 'a1300000-0000-0000-0000-000000000001', 'approved', 'form', NULL,
   encode(extensions.digest(rpad('regf-noend-24', 32, 'x'), 'sha256'), 'hex')),
  ('a1400000-0000-0000-0000-000000000007', 'a10a0000-0000-0000-0000-0000000000aa',
   'a1100000-0000-0000-0000-0000000000e4', 'a1300000-0000-0000-0000-000000000001', 'approved', 'form', NULL,
   encode(extensions.digest(rpad('regf-noend-23', 32, 'x'), 'sha256'), 'hex')),
  ('a1400000-0000-0000-0000-0000000000b1', 'a10b0000-0000-0000-0000-0000000000bb',
   'a1100000-0000-0000-0000-0000000000e5', 'a1300000-0000-0000-0000-0000000000b1', 'approved', 'form', NULL,
   encode(extensions.digest(rpad('regf-b', 32, 'x'), 'sha256'), 'hex'));

-- Zgloszenie nieoplacone na bilet platny, z oferta early bird (5000) wazna godzine.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
   quoted_price_cents, quoted_currency, quote_valid_until) VALUES
  ('a1400000-0000-0000-0000-0000000000c1', 'a10a0000-0000-0000-0000-0000000000aa',
   'a1100000-0000-0000-0000-0000000000e1', 'a1300000-0000-0000-0000-000000000005',
   'a1200000-0000-0000-0000-0000000000f1', 'pending', 'form', 'unpaid',
   5000, 'PLN', now() + interval '1 hour');

-- Werdykt resolvera jako napis „<id|->:<werdykt>" - jedna asercja na wiersz.
CREATE FUNCTION pg_temp.regf_resolve(_tenant uuid, _token text, _purpose text) RETURNS text
LANGUAGE sql AS $$
  SELECT COALESCE(k.registration_id::text, '-') || ':' || k.verdict
    FROM public._event_manage_token_resolve(_tenant, _token, _purpose) k
$$;

-- Cena jednostkowa zgloszenia c1 z biletem f1 (albo bez biletu).
CREATE FUNCTION pg_temp.regf_price(_with_ticket boolean DEFAULT true) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public._event_registration_unit_price(
    r,
    CASE WHEN _with_ticket
      THEN (SELECT t FROM public.event_ticket_types t WHERE t.id = 'a1200000-0000-0000-0000-0000000000f1')
      ELSE NULL::public.event_ticket_types END)
    FROM public.event_registrations r
   WHERE r.id = 'a1400000-0000-0000-0000-0000000000c1'
$$;

-- ── 1-15. Uprawnienia i opisy ────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public._event_uid_owns_email(uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_uid_owns_email(uuid,text)', 'EXECUTE'),
  '_event_uid_owns_email: bez EXECUTE dla klienta (czyta auth.users)');
SELECT ok(has_function_privilege('service_role', 'public._event_uid_owns_email(uuid,text)', 'EXECUTE'),
  '_event_uid_owns_email: service_role');
SELECT ok(NOT has_function_privilege('anon', 'public._event_bind_uid_for_email(uuid,uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_bind_uid_for_email(uuid,uuid,text)', 'EXECUTE'),
  '_event_bind_uid_for_email: bez EXECUTE dla klienta');
SELECT ok(has_function_privilege('service_role', 'public._event_bind_uid_for_email(uuid,uuid,text)', 'EXECUTE'),
  '_event_bind_uid_for_email: service_role');
SELECT ok(NOT has_function_privilege('anon', 'public._require_server_probe(uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._require_server_probe(uuid,text)', 'EXECUTE'),
  '_require_server_probe: bez EXECUTE dla klienta');
SELECT ok(has_function_privilege('service_role', 'public._require_server_probe(uuid,text)', 'EXECUTE'),
  '_require_server_probe: service_role');
SELECT ok(NOT has_function_privilege('anon', 'public._event_manage_token_resolve(uuid,text,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_manage_token_resolve(uuid,text,text)', 'EXECUTE'),
  '_event_manage_token_resolve: bez EXECUTE dla klienta (wyrocznia kluczy)');
SELECT ok(has_function_privilege('service_role', 'public._event_manage_token_resolve(uuid,text,text)', 'EXECUTE'),
  '_event_manage_token_resolve: service_role');
SELECT ok(NOT has_function_privilege('anon', 'public.event_registration_notify_payload_for_tenant(uuid,jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.event_registration_notify_payload_for_tenant(uuid,jsonb)', 'EXECUTE'),
  'event_registration_notify_payload_for_tenant: bez EXECUTE dla klienta (najemca z argumentu)');
SELECT ok(has_function_privilege('service_role', 'public.event_registration_notify_payload_for_tenant(uuid,jsonb)', 'EXECUTE'),
  'event_registration_notify_payload_for_tenant: service_role (funkcja serwerowa)');
SELECT ok(NOT has_function_privilege('anon', 'public._event_registration_quote_ttl()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_registration_quote_ttl()', 'EXECUTE'),
  '_event_registration_quote_ttl: bez EXECUTE dla klienta');
SELECT ok(has_function_privilege('service_role', 'public._event_registration_quote_ttl()', 'EXECUTE'),
  '_event_registration_quote_ttl: service_role');
SELECT ok(NOT has_function_privilege('anon', 'public._event_registration_unit_price(public.event_registrations,public.event_ticket_types)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_registration_unit_price(public.event_registrations,public.event_ticket_types)', 'EXECUTE'),
  '_event_registration_unit_price: bez EXECUTE dla klienta');
SELECT ok(has_function_privilege('service_role', 'public._event_registration_unit_price(public.event_registrations,public.event_ticket_types)', 'EXECUTE'),
  '_event_registration_unit_price: service_role');
SELECT is(
  (SELECT count(*)::int FROM unnest(ARRAY[
     'public._event_uid_owns_email(uuid,text)',
     'public._event_bind_uid_for_email(uuid,uuid,text)',
     'public._require_server_probe(uuid,text)',
     'public._event_manage_token_resolve(uuid,text,text)',
     'public.event_registration_notify_payload_for_tenant(uuid,jsonb)',
     'public._event_registration_quote_ttl()',
     'public._event_registration_unit_price(public.event_registrations,public.event_ticket_types)'
   ]) AS f(sig)
   WHERE COALESCE(obj_description(f.sig::regprocedure, 'pg_proc'), '') <> ''),
  7, 'kazda nowa funkcja ma COMMENT ON FUNCTION');

-- ── 16-21. _event_uid_owns_email ─────────────────────────────────────────────
SELECT is(public._event_uid_owns_email('a1000000-0000-0000-0000-0000000000a1', '  REGF-Owner@Example.ORG '),
  true, 'potwierdzony adres konta (wielkosc liter i spacje bez znaczenia) -> true');
SELECT is(public._event_uid_owns_email('a1000000-0000-0000-0000-0000000000a2', 'regf-unconf@example.org'),
  false, 'adres NIEPOTWIERDZONY -> false (sam adres konta to jeszcze nie dowod)');
SELECT is(public._event_uid_owns_email('a1000000-0000-0000-0000-0000000000a1', 'regf-guest@example.org'),
  false, 'cudzy adres -> false');
SELECT is(public._event_uid_owns_email(NULL, 'regf-owner@example.org'),
  false, 'anonim (NULL) -> false, nie NULL');
SELECT is(public._event_uid_owns_email('a1000000-0000-0000-0000-0000000000a1', NULL),
  false, 'brak adresu (NULL) -> false, nie NULL');
SELECT is(public._event_uid_owns_email('a1000000-0000-0000-0000-0000000000a1', '   '),
  false, 'pusty adres -> false');

-- ── 22-29. _event_bind_uid_for_email ─────────────────────────────────────────
SELECT is(public._event_bind_uid_for_email('a10a0000-0000-0000-0000-0000000000aa',
    'a1000000-0000-0000-0000-0000000000a1', 'regf-owner@example.org'),
  'a1000000-0000-0000-0000-0000000000a1'::uuid, 'potwierdzony wlasny adres, konto wolne -> konto');
SELECT is(public._event_bind_uid_for_email('a10a0000-0000-0000-0000-0000000000aa',
    'a1000000-0000-0000-0000-0000000000a1', 'regf-guest@example.org'),
  NULL::uuid, 'REG-01: konto podaje CUDZY adres -> NULL (osoba zostaje niedowiazana)');
SELECT is(public._event_bind_uid_for_email('a10a0000-0000-0000-0000-0000000000aa',
    'a1000000-0000-0000-0000-0000000000a3', 'regf-bound@example.org'),
  NULL::uuid, 'konto dowiazane do INNEJ osoby (inny adres) -> NULL, bez 23505 na unikalnosci');
SELECT is(public._event_bind_uid_for_email('a10a0000-0000-0000-0000-0000000000aa',
    'a1000000-0000-0000-0000-0000000000a4', ' REGF-Same@Example.org'),
  'a1000000-0000-0000-0000-0000000000a4'::uuid, 'konto dowiazane do osoby o TYM SAMYM adresie -> konto (no-op)');
SELECT is(public._event_bind_uid_for_email('a10a0000-0000-0000-0000-0000000000aa',
    NULL, 'regf-owner@example.org'),
  NULL::uuid, 'anonim -> NULL');
SELECT is(public._event_bind_uid_for_email('a10a0000-0000-0000-0000-0000000000aa',
    'a1000000-0000-0000-0000-0000000000a2', 'regf-unconf@example.org'),
  NULL::uuid, 'konto bez potwierdzonego adresu -> NULL');
SELECT is(public._event_bind_uid_for_email(NULL,
    'a1000000-0000-0000-0000-0000000000a1', 'regf-owner@example.org'),
  NULL::uuid, 'brak najemcy -> NULL');
SELECT is(public._event_bind_uid_for_email('a10b0000-0000-0000-0000-0000000000bb',
    'a1000000-0000-0000-0000-0000000000a3', 'regf-bound@example.org'),
  'a1000000-0000-0000-0000-0000000000a3'::uuid, 'dowiazanie w najemcy A nie blokuje najemcy B (unikalnosc per najemca)');

-- ── 30-35. _require_server_probe ─────────────────────────────────────────────
SELECT throws_ok(
  $$SELECT public._require_server_probe('a10a0000-0000-0000-0000-0000000000aa', '203.0.113.7')$$,
  'P0001', 'invalid_payload: probe subject must be a salted address hash',
  'surowy adres IP -> invalid_payload (do bazy idzie tylko solony skrot)');
SELECT throws_ok(
  $$SELECT public._require_server_probe('a10a0000-0000-0000-0000-0000000000aa', 'ip:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')$$,
  'P0001', 'invalid_payload: probe subject must be a salted address hash',
  'zly ksztalt (wielkie litery) -> invalid_payload');
SELECT throws_ok(
  $$SELECT public._require_server_probe('a10a0000-0000-0000-0000-0000000000aa', 'ip:' || repeat('a', 31))$$,
  'P0001', 'invalid_payload: probe subject must be a salted address hash',
  'zla dlugosc skrotu -> invalid_payload');
SELECT throws_ok(
  $$SELECT public._require_server_probe(NULL, 'ip:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  'P0001', 'invalid_payload: tenant is required',
  'brak najemcy -> invalid_payload');
SELECT throws_ok(
  $$SELECT public._require_server_probe('a10a0000-0000-0000-0000-0000000000aa', NULL)$$,
  'P0001', 'invalid_payload: probe subject must be a salted address hash',
  'brak adresu -> invalid_payload');
SELECT lives_ok(
  $$SELECT public._require_server_probe('a10a0000-0000-0000-0000-0000000000aa', 'ip:0123456789abcdef0123456789abcdef')$$,
  'solony skrot i najemca -> bez wyjatku');

-- ── 36-52. _event_manage_token_resolve ───────────────────────────────────────
SELECT is(pg_temp.regf_resolve('a10a0000-0000-0000-0000-0000000000aa', 'short', 'view'),
  '-:not_found', 'klucz w zlym ksztalcie -> not_found bez id');
SELECT is(pg_temp.regf_resolve(NULL, rpad('regf-ok', 32, 'x'), 'view'),
  '-:not_found', 'brak najemcy -> not_found');
SELECT is(pg_temp.regf_resolve('a10b0000-0000-0000-0000-0000000000bb', rpad('regf-ok', 32, 'x'), 'view'),
  '-:not_found', 'klucz najemcy A u najemcy B -> not_found (jak klucz nieistniejacy)');
SELECT is(pg_temp.regf_resolve('a10a0000-0000-0000-0000-0000000000aa', rpad('regf-nope', 32, 'x'), 'view'),
  '-:not_found', 'nieznany klucz w dobrym ksztalcie -> not_found');
SELECT is(pg_temp.regf_resolve('a10a0000-0000-0000-0000-0000000000aa', rpad('regf-ok', 32, 'x'), 'act'),
  'a1400000-0000-0000-0000-000000000001:ok', 'wazny klucz, zgloszenie otwarte -> ok z id');
SELECT is(pg_temp.regf_resolve('a10a0000-0000-0000-0000-0000000000aa', '  ' || rpad('regf-ok', 32, 'x') || ' ', 'view'),
  'a1400000-0000-0000-0000-000000000001:ok', 'spacje wokol klucza bez znaczenia (btrim jak dotad)');
SELECT is(pg_temp.regf_resolve('a10a0000-0000-0000-0000-0000000000aa', rpad('regf-ended', 32, 'x'), 'view'),
  'a1400000-0000-0000-0000-000000000004:expired', 'REG-17: po ends_at klucz wygasa (takze dla podgladu)');
SELECT is(pg_temp.regf_resolve('a10a0000-0000-0000-0000-0000000000aa', rpad('regf-noend-24', 32, 'x'), 'view'),
  'a1400000-0000-0000-0000-000000000006:expired', 'bez ends_at: po starts_at + 24 h klucz wygasa');
SELECT is(pg_temp.regf_resolve('a10a0000-0000-0000-0000-0000000000aa', rpad('regf-noend-23', 32, 'x'), 'act'),
  'a1400000-0000-0000-0000-000000000007:ok', 'bez ends_at: 23 h po starcie klucz nadal wazny');
SELECT is(pg_temp.regf_resolve('a10a0000-0000-0000-0000-0000000000aa', rpad('regf-cancel', 32, 'x'), 'act'),
  'a1400000-0000-0000-0000-000000000002:closed', 'anulowane + akcja -> closed');
SELECT is(pg_temp.regf_resolve('a10a0000-0000-0000-0000-0000000000aa', rpad('regf-cancel', 32, 'x'), 'contact'),
  'a1400000-0000-0000-0000-000000000002:closed', 'anulowane + dane kontaktowe -> closed');
SELECT is(pg_temp.regf_resolve('a10a0000-0000-0000-0000-0000000000aa', rpad('regf-cancel', 32, 'x'), 'view'),
  'a1400000-0000-0000-0000-000000000002:ok', 'anulowane + podglad statusu -> ok (link pokazuje „anulowane")');
SELECT is(pg_temp.regf_resolve('a10a0000-0000-0000-0000-0000000000aa', rpad('regf-reject', 32, 'x'), 'act'),
  'a1400000-0000-0000-0000-000000000003:closed', 'odrzucone + akcja -> closed');
SELECT is(pg_temp.regf_resolve('a10a0000-0000-0000-0000-0000000000aa', rpad('regf-ended-cx', 32, 'x'), 'view'),
  'a1400000-0000-0000-0000-000000000005:expired', 'wygasniecie ma pierwszenstwo przed zamknieciem');
SELECT is(pg_temp.regf_resolve('a10b0000-0000-0000-0000-0000000000bb', rpad('regf-b', 32, 'x'), 'act'),
  'a1400000-0000-0000-0000-0000000000b1:ok', 'kontrprzypadek: klucz najemcy B dziala u najemcy B');
SELECT throws_ok(
  $$SELECT * FROM public._event_manage_token_resolve('a10a0000-0000-0000-0000-0000000000aa', 'short', 'delete')$$,
  'P0001', 'invalid_payload: manage token purpose must be view, act or contact',
  'cel spoza listy -> wyjatek (blad wolajacego), takze przy zlym kluczu');
SELECT throws_ok(
  $$SELECT * FROM public._event_manage_token_resolve('a10a0000-0000-0000-0000-0000000000aa', 'short', NULL)$$,
  'P0001', 'invalid_payload: manage token purpose must be view, act or contact',
  'brak celu -> wyjatek');

-- ── 53-61. event_registration_notify_payload_for_tenant (service_role) ───────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  public.event_registration_notify_payload_for_tenant('a10a0000-0000-0000-0000-0000000000aa',
    jsonb_build_object('manage_token', rpad('regf-ok', 32, 'x'))) ->> 'email',
  'regf-guest@example.org', 'wazny klucz u swojego najemcy -> adres odbiorcy');
SELECT ok(
  public.event_registration_notify_payload_for_tenant('a10a0000-0000-0000-0000-0000000000aa',
    jsonb_build_object('manage_token', rpad('regf-ok', 32, 'x')))
  ?& ARRAY['registration_id', 'tenant_id', 'status', 'waitlist_position', 'email', 'first_name', 'lang',
           'event_id', 'event_slug', 'event_title_pl', 'event_title_en', 'event_starts_at',
           'event_timezone', 'event_location', 'ticket_name_pl', 'ticket_name_en'],
  'ksztalt ladunku maila bez zmian (wszystkie klucze czytane przez TS)');
SELECT ok(
  NOT (public.event_registration_notify_payload_for_tenant('a10a0000-0000-0000-0000-0000000000aa',
         jsonb_build_object('manage_token', rpad('regf-ok', 32, 'x'))) ?| ARRAY['decision_note', 'last_name']),
  'bez decision_note (notatka wewnetrzna) i last_name (minimalizacja)');
SELECT throws_ok(
  $$SELECT public.event_registration_notify_payload_for_tenant('a10a0000-0000-0000-0000-0000000000aa',
      jsonb_build_object('manage_token', rpad('regf-ended', 32, 'x')))$$,
  'P0001', 'manage_expired: this management link expired when the event ended',
  'REG-17: po koncu wydarzenia klucz nie oddaje danych');
SELECT throws_ok(
  $$SELECT public.event_registration_notify_payload_for_tenant('a10a0000-0000-0000-0000-0000000000aa',
      jsonb_build_object('manage_token', rpad('regf-cancel', 32, 'x')))$$,
  'P0001', 'not_found: registration does not exist',
  'REG-17: zgloszenie anulowane -> not_found (bez adresu i imienia)');
SELECT throws_ok(
  $$SELECT public.event_registration_notify_payload_for_tenant('a10b0000-0000-0000-0000-0000000000bb',
      jsonb_build_object('manage_token', rpad('regf-ok', 32, 'x')))$$,
  'P0001', 'not_found: registration does not exist',
  'klucz najemcy A z najemca B -> not_found');
SELECT throws_ok(
  $$SELECT public.event_registration_notify_payload_for_tenant(NULL,
      jsonb_build_object('manage_token', rpad('regf-ok', 32, 'x')))$$,
  'P0001', 'invalid_payload: tenant is required',
  'brak najemcy -> invalid_payload (nie domyslny najemca)');
SELECT throws_ok(
  $$SELECT public.event_registration_notify_payload_for_tenant('a10a0000-0000-0000-0000-0000000000aa', '{}'::jsonb)$$,
  'P0001', 'invalid_request: manage_token is required',
  'brak klucza -> invalid_request');
SELECT throws_ok(
  $$SELECT public.event_registration_notify_payload_for_tenant('a10a0000-0000-0000-0000-0000000000aa',
      '{"manage_token":"za-krotki"}'::jsonb)$$,
  'P0001', 'not_found: registration does not exist',
  'klucz w zlym ksztalcie -> not_found');
RESET ROLE;

-- ── 62-70. _event_registration_unit_price ───────────────────────────────────
SELECT is(
  public._event_ticket_price_now(10000, 5000, now() - interval '1 second', '[]'::jsonb),
  10000, 'warunek wstepny: early bird minal, cena biezaca 10000');
SELECT is((pg_temp.regf_price() ->> 'amount_cents')::int, 5000,
  'REG-16: granica early birda - oferta 5000 z chwili zapisu obowiazuje mimo ceny biezacej 10000');
SELECT ok(pg_temp.regf_price() ->> 'source' = 'quote'
      AND (pg_temp.regf_price() ->> 'quote_valid_until')::timestamptz = now() + interval '1 hour',
  'zrodlo quote i termin waznosci oferty w wyniku');
UPDATE public.event_registrations SET quoted_price_cents = 12000
 WHERE id = 'a1400000-0000-0000-0000-0000000000c1';
SELECT is(pg_temp.regf_price(), jsonb_build_object('amount_cents', 10000, 'source', 'quote',
    'quote_valid_until', now() + interval '1 hour'),
  'oferta wyzsza niz cena biezaca -> LEAST (obnizka przechodzi na uczestnika)');
UPDATE public.event_registrations SET quoted_price_cents = 5000, quote_valid_until = now() - interval '1 second'
 WHERE id = 'a1400000-0000-0000-0000-0000000000c1';
SELECT is(pg_temp.regf_price(), jsonb_build_object('amount_cents', 10000, 'source', 'current',
    'quote_valid_until', NULL),
  'oferta wygasla -> cena biezaca, bez terminu');
UPDATE public.event_registrations SET quote_valid_until = now()
 WHERE id = 'a1400000-0000-0000-0000-0000000000c1';
SELECT is(pg_temp.regf_price() ->> 'source', 'quote',
  'oferta wazna DO quote_valid_until wlacznie');
UPDATE public.event_registrations SET quoted_currency = 'EUR', quote_valid_until = now() + interval '1 hour'
 WHERE id = 'a1400000-0000-0000-0000-0000000000c1';
SELECT is(pg_temp.regf_price(), jsonb_build_object('amount_cents', 10000, 'source', 'current',
    'quote_valid_until', NULL),
  'waluta oferty inna niz waluta biletu -> cena biezaca');
UPDATE public.event_registrations
   SET quoted_price_cents = NULL, quoted_currency = NULL, quote_valid_until = NULL
 WHERE id = 'a1400000-0000-0000-0000-0000000000c1';
SELECT is(pg_temp.regf_price(), jsonb_build_object('amount_cents', 10000, 'source', 'current',
    'quote_valid_until', NULL),
  'brak oferty (zgloszenia sprzed migracji) -> cena biezaca jak dotad');
SELECT is(pg_temp.regf_price(false), jsonb_build_object('amount_cents', 0, 'source', 'current',
    'quote_valid_until', NULL),
  'brak biletu -> 0');

-- ── 71. Czas waznosci oferty ─────────────────────────────────────────────────
SELECT is(public._event_registration_quote_ttl(), interval '72 hours', 'oferta wazna 72 h');

-- ── 72-77. CHECK event_registrations_quote_shape ─────────────────────────────
SELECT throws_like(
  $$UPDATE public.event_registrations SET quoted_price_cents = NULL, quoted_currency = 'PLN',
      quote_valid_until = now() + interval '1 hour' WHERE id = 'a1400000-0000-0000-0000-0000000000c1'$$,
  '%event_registrations_quote_shape%', 'oferta bez ceny -> odrzucona (NULL >= 0 nie przechodzi)');
SELECT throws_like(
  $$UPDATE public.event_registrations SET quoted_price_cents = 5000, quoted_currency = NULL,
      quote_valid_until = now() + interval '1 hour' WHERE id = 'a1400000-0000-0000-0000-0000000000c1'$$,
  '%event_registrations_quote_shape%', 'oferta bez waluty -> odrzucona');
SELECT throws_like(
  $$UPDATE public.event_registrations SET quoted_price_cents = 5000, quoted_currency = 'PLN',
      quote_valid_until = NULL WHERE id = 'a1400000-0000-0000-0000-0000000000c1'$$,
  '%event_registrations_quote_shape%', 'oferta bez terminu -> odrzucona');
SELECT throws_like(
  $$UPDATE public.event_registrations SET quoted_price_cents = -1, quoted_currency = 'PLN',
      quote_valid_until = now() WHERE id = 'a1400000-0000-0000-0000-0000000000c1'$$,
  '%event_registrations_quote_shape%', 'ujemna cena -> odrzucona');
SELECT throws_like(
  $$UPDATE public.event_registrations SET quoted_price_cents = 5000, quoted_currency = 'USD',
      quote_valid_until = now() WHERE id = 'a1400000-0000-0000-0000-0000000000c1'$$,
  '%event_registrations_quote_shape%', 'waluta spoza PLN|EUR -> odrzucona');
SELECT lives_ok(
  $$UPDATE public.event_registrations SET quoted_price_cents = 0, quoted_currency = 'EUR',
      quote_valid_until = now() WHERE id = 'a1400000-0000-0000-0000-0000000000c1'$$,
  'pelna oferta (takze 0) -> przyjeta');

-- ── 78-80. Kolumny ───────────────────────────────────────────────────────────
SELECT col_type_is('public', 'event_registrations', 'quoted_price_cents', 'integer', 'quoted_price_cents integer');
SELECT col_type_is('public', 'event_registrations', 'quoted_currency', 'text', 'quoted_currency text');
SELECT col_type_is('public', 'event_registrations', 'quote_valid_until', 'timestamp with time zone',
  'quote_valid_until timestamptz');

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
