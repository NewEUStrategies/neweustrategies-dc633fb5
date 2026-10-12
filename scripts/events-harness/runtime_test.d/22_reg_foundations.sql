-- ============================================================================
-- 22_reg_foundations - FUNDAMENTY NAPRAWY ZAPISOW REG (20261012100000)
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracja 20261012100000 stawia reguly, na ktorych stoi reszta serii REG:
-- wiazanie konta tylko przez POTWIERDZONY adres (REG-01), jedna regula klucza
-- samoobslugi i dane do maila po najemcy z serwera (REG-17) oraz migawka ceny
-- zgloszenia (REG-16). pgTAP (supabase/tests/reg_foundations_test.sql)
-- przypina je na pelnym schemacie; ten plik sprawdza je na REPLAYU modulu,
-- czyli na tych samych cialach, ktore dostaja wszystkie pozostale pliki
-- harnessu - i na atrapie `auth.users`, na ktorej te pliki stoja.
--
-- CO SPRAWDZA
--   1. Atrapa `auth.users.email_confirmed_at`: konto wstawione jako `(id, email)`
--      jest potwierdzone (DEFAULT now() - tak wyglada kazda sesja produkcyjna),
--      a jawny NULL daje konto niepotwierdzone.
--   2. `_event_bind_uid_for_email`: konto dowiazane do innej osoby najemcy nie
--      wiaze sie drugi raz; w innym najemcy - tak. `_require_server_probe`:
--      surowy adres IP odrzucony, solony skrot przechodzi.
--   3. `_event_manage_token_resolve` na kluczu z PRAWDZIWEGO generatora
--      (`_event_new_qr_token`, ten sam co w zapisie): ok, obcy najemca, zly
--      ksztalt, wygasniecie po ends_at i (bez ends_at) po starts_at + 24 h,
--      zamkniecie po anulowaniu, przywrocenie waznosci po przelozeniu
--      wydarzenia na pozniej.
--   4. `event_registration_notify_payload_for_tenant`: dane bez nazwiska
--      i notatki, `manage_expired`, `not_found` po anulowaniu i u obcego.
--   5. `_event_registration_unit_price`: granica early birda (oferta 5000,
--      cena biezaca 10000 -> 5000), LEAST, wygasla oferta, inna waluta, brak
--      oferty; CHECK ksztaltu oferty odrzuca oferte czesciowa.
--
-- CZEGO NIE SPRAWDZA: pelnego ACL i kazdej kombinacji CHECK (pgTAP), ani
-- konsumentow tych regul - ci przechodza na nie w kolejnych migracjach serii
-- i maja wlasne pliki.
--
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================
\echo '== 22 fundamenty REG: konto, klucz samoobslugi, cena =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'Tenant C2 (fundamenty REG)', 'tc2-regf'),
  ('c2b2c2b2-c2b2-c2b2-c2b2-c2b2c2b2c2b2', 'Tenant C2B (obcy najemca)', 'tc2b-regf');

-- 01: konto potwierdzone (domyslnie), 02: potwierdzone i dowiazane w C2 do osoby
-- o INNYM adresie, 03: jawnie NIEPOTWIERDZONE.
INSERT INTO auth.users (id, email) VALUES
  ('c2000000-0000-0000-0000-000000000001', 'konto.regf@example.org'),
  ('c2000000-0000-0000-0000-000000000002', 'zwiazane.regf@example.org');
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('c2000000-0000-0000-0000-000000000003', 'niepotw.regf@example.org', NULL);

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
  registration_mode, registration_flow) VALUES
  ('c2100000-0000-0000-0000-000000000001', 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'regf-przyszle',
   'Przyszle', 'Future', now() + interval '30 days', NULL, 'published', 'form', 'instant'),
  ('c2100000-0000-0000-0000-000000000002', 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'regf-po',
   'Zakonczone', 'Ended', now() - interval '2 days', now() - interval '1 minute', 'published', 'form', 'instant'),
  ('c2100000-0000-0000-0000-000000000003', 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'regf-bez-konca-24',
   'Bez konca 24h', 'No end 24h', now() - interval '24 hours 1 second', NULL, 'published', 'form', 'instant'),
  ('c2100000-0000-0000-0000-000000000004', 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'regf-bez-konca-23',
   'Bez konca 23h', 'No end 23h', now() - interval '23 hours', NULL, 'published', 'form', 'instant');

-- Bilet platny: early bird 5000 skonczyl sie sekunde temu, cena biezaca 10000.
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
  early_bird_price_cents, early_bird_until, quota, min_tier_rank, requires_approval, is_active, sort_order) VALUES
  ('c2200000-0000-0000-0000-000000000001', 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
   'c2100000-0000-0000-0000-000000000001', 'regf_paid', 'Platny', 'Paid', 10000, 'PLN',
   5000, now() - interval '1 second', NULL, 0, false, true, 10);

INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name, user_id) VALUES
  ('c2300000-0000-0000-0000-000000000001', 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
   'gosc.regf@example.org', 'Gosc', 'Nazwiskowy', NULL),
  ('c2300000-0000-0000-0000-000000000002', 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
   'inna.regf@example.org', 'Inna', 'Osoba', 'c2000000-0000-0000-0000-000000000002'),
  ('c2300000-0000-0000-0000-000000000003', 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
   'cena.regf@example.org', 'Cena', 'Oferta', NULL);

-- Klucz z PRAWDZIWEGO generatora zapisu, w bazie tylko jego sha256 - dokladnie
-- tak, jak robi to `event_register`. Jawny klucz zostaje w tabeli tymczasowej.
CREATE TEMP TABLE regf_tok (k text PRIMARY KEY, token text NOT NULL, reg uuid NOT NULL);

CREATE FUNCTION pg_temp.regf_reg(_k text, _event uuid, _status text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_token text := public._event_new_qr_token(); v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, status, registration_mode, cancelled_at, manage_token_hash)
  VALUES
    (v_id, 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', _event, 'c2300000-0000-0000-0000-000000000001',
     _status, 'form', CASE WHEN _status = 'cancelled' THEN now() END,
     encode(extensions.digest(v_token, 'sha256'), 'hex'));
  INSERT INTO regf_tok VALUES (_k, v_token, v_id);
  RETURN v_id;
END $$;

SELECT pg_temp.regf_reg('ok', 'c2100000-0000-0000-0000-000000000001', 'approved');
SELECT pg_temp.regf_reg('cancel', 'c2100000-0000-0000-0000-000000000001', 'cancelled');
SELECT pg_temp.regf_reg('ended', 'c2100000-0000-0000-0000-000000000002', 'approved');
SELECT pg_temp.regf_reg('noend24', 'c2100000-0000-0000-0000-000000000003', 'approved');
SELECT pg_temp.regf_reg('noend23', 'c2100000-0000-0000-0000-000000000004', 'approved');

-- Werdykt resolvera dla klucza z tabeli: „<zgodnosc id>:<werdykt>", gdzie
-- zgodnosc id to 'id' (to samo zgloszenie), '-' (brak id) albo 'OBCE'.
CREATE FUNCTION pg_temp.regf_verdict(_tenant uuid, _k text, _purpose text) RETURNS text
LANGUAGE sql AS $$
  SELECT CASE WHEN k.registration_id IS NULL THEN '-'
              WHEN k.registration_id = t.reg THEN 'id'
              ELSE 'OBCE' END || ':' || k.verdict
    FROM regf_tok t, public._event_manage_token_resolve(_tenant, t.token, _purpose) k
   WHERE t.k = _k
$$;

-- ---------------------------------------------------------------------------
-- 1. Atrapa potwierdzenia adresu i wiazanie konta
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  public._event_uid_owns_email('c2000000-0000-0000-0000-000000000001', ' Konto.REGF@example.org'),
  'konto: (id, email) w atrapie = konto POTWIERDZONE (DEFAULT now()), wielkosc liter bez znaczenia');
SELECT pg_temp.assert(
  NOT public._event_uid_owns_email('c2000000-0000-0000-0000-000000000003', 'niepotw.regf@example.org'),
  'konto: jawny email_confirmed_at = NULL -> adres niepotwierdzony');
SELECT pg_temp.assert(
  NOT public._event_uid_owns_email('c2000000-0000-0000-0000-000000000001', 'gosc.regf@example.org'),
  'konto: cudzy adres -> brak dowodu wlasnosci');
SELECT pg_temp.assert(
  public._event_bind_uid_for_email('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
    'c2000000-0000-0000-0000-000000000001', 'gosc.regf@example.org') IS NULL,
  'wiazanie: REG-01 - konto podajace adres goscia NIE dostaje jego kartoteki');
SELECT pg_temp.assert(
  public._event_bind_uid_for_email('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
    'c2000000-0000-0000-0000-000000000002', 'zwiazane.regf@example.org') IS NULL,
  'wiazanie: konto dowiazane do innej osoby najemcy -> NULL (bez 23505)');
SELECT pg_temp.assert(
  public._event_bind_uid_for_email('c2b2c2b2-c2b2-c2b2-c2b2-c2b2c2b2c2b2',
    'c2000000-0000-0000-0000-000000000002', 'zwiazane.regf@example.org') = 'c2000000-0000-0000-0000-000000000002',
  'wiazanie: w innym najemcy to samo konto jest wolne');
-- Sciezka serwerowa bez konta: do bazy idzie wylacznie solony skrot adresu.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public._require_server_probe('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', '203.0.113.7')$q$,
  'invalid_payload: probe subject', 'adres: surowy IP odrzucony (tylko solony skrot)');
SELECT public._require_server_probe('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'ip:0123456789abcdef0123456789abcdef');
SELECT pg_temp.assert(true, 'adres: solony skrot i najemca przechodza');

-- ---------------------------------------------------------------------------
-- 2. Klucz samoobslugi
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT bool_and(t.token ~ '^[A-Za-z0-9_-]{32}$') FROM regf_tok t),
  'klucz: generator zapisu daje dokladnie ksztalt, ktory resolver przyjmuje');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_manage_token_resolve(uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_manage_token_resolve(uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_registration_notify_payload_for_tenant(uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_registration_notify_payload_for_tenant(uuid,jsonb)', 'EXECUTE'),
  'klucz: resolver i dane do maila bez EXECUTE dla klienta');
SELECT pg_temp.assert(pg_temp.regf_verdict('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'ok', 'act') = 'id:ok',
  'klucz: wazny, zgloszenie otwarte -> ok');
SELECT pg_temp.assert(pg_temp.regf_verdict('c2b2c2b2-c2b2-c2b2-c2b2-c2b2c2b2c2b2', 'ok', 'view') = '-:not_found',
  'klucz: obcy najemca -> not_found bez id');
SELECT pg_temp.assert(
  (SELECT k.verdict FROM public._event_manage_token_resolve('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
     (SELECT left(token, 31) FROM regf_tok WHERE k = 'ok'), 'view') k) = 'not_found',
  'klucz: zly ksztalt (31 znakow) -> not_found');
SELECT pg_temp.assert(pg_temp.regf_verdict('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'ended', 'view') = 'id:expired',
  'klucz: REG-17 - po ends_at wygasa');
SELECT pg_temp.assert(pg_temp.regf_verdict('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'noend24', 'view') = 'id:expired',
  'klucz: bez ends_at wygasa po starts_at + 24 h');
SELECT pg_temp.assert(pg_temp.regf_verdict('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'noend23', 'act') = 'id:ok',
  'klucz: bez ends_at 23 h po starcie nadal wazny');
SELECT pg_temp.assert(pg_temp.regf_verdict('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'cancel', 'act') = 'id:closed',
  'klucz: anulowane + akcja -> closed');
SELECT pg_temp.assert(pg_temp.regf_verdict('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'cancel', 'contact') = 'id:closed',
  'klucz: anulowane + dane kontaktowe -> closed');
SELECT pg_temp.assert(pg_temp.regf_verdict('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'cancel', 'view') = 'id:ok',
  'klucz: anulowane + podglad statusu -> ok');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public._event_manage_token_resolve('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'x', 'delete')$q$,
  'invalid_payload: manage token purpose', 'klucz: cel spoza listy -> blad wolajacego');

-- ---------------------------------------------------------------------------
-- 3. Dane do maila po kluczu, najemca z argumentu
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT p->>'email' = 'gosc.regf@example.org'
      AND p->>'first_name' = 'Gosc'
      AND p->>'tenant_id' = 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2'
      AND NOT (p ?| ARRAY['last_name', 'decision_note'])
     FROM (SELECT public.event_registration_notify_payload_for_tenant('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
             jsonb_build_object('manage_token', t.token)) AS p
             FROM regf_tok t WHERE t.k = 'ok') s),
  'mail: adres, imie i najemca - bez nazwiska i notatki wewnetrznej');
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.event_registration_notify_payload_for_tenant('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', %L)$q$,
    (SELECT jsonb_build_object('manage_token', token) FROM regf_tok WHERE k = 'noend24')),
  'manage_expired', 'mail: REG-17 - po koncu wydarzenia klucz nie oddaje danych');
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.event_registration_notify_payload_for_tenant('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', %L)$q$,
    (SELECT jsonb_build_object('manage_token', token) FROM regf_tok WHERE k = 'cancel')),
  'not_found', 'mail: zgloszenie anulowane -> not_found');
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.event_registration_notify_payload_for_tenant('c2b2c2b2-c2b2-c2b2-c2b2-c2b2c2b2c2b2', %L)$q$,
    (SELECT jsonb_build_object('manage_token', token) FROM regf_tok WHERE k = 'ok')),
  'not_found', 'mail: klucz najemcy C2 z najemca C2B -> not_found');

-- Przelozenie zakonczonego wydarzenia na pozniej przywraca waznosc klucza -
-- klucz sluzy do udzialu w TYM wydarzeniu, a granica liczy sie z biezacych dat.
UPDATE public.events SET starts_at = now() + interval '10 days', ends_at = now() + interval '11 days'
 WHERE id = 'c2100000-0000-0000-0000-000000000002';
SELECT pg_temp.assert(pg_temp.regf_verdict('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'ended', 'act') = 'id:ok',
  'klucz: po przelozeniu wydarzenia na pozniej znowu wazny');

-- ---------------------------------------------------------------------------
-- 4. Cena jednostkowa zgloszenia
-- ---------------------------------------------------------------------------
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
   quoted_price_cents, quoted_currency, quote_valid_until)
VALUES
  ('c2400000-0000-0000-0000-000000000001', 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
   'c2100000-0000-0000-0000-000000000001', 'c2300000-0000-0000-0000-000000000003',
   'c2200000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid',
   5000, 'PLN', now() + interval '1 hour');

CREATE FUNCTION pg_temp.regf_price() RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public._event_registration_unit_price(r, t)
    FROM public.event_registrations r
    JOIN public.event_ticket_types t ON t.id = r.ticket_type_id AND t.tenant_id = r.tenant_id
   WHERE r.id = 'c2400000-0000-0000-0000-000000000001'
$$;

SELECT pg_temp.assert(
  (SELECT public._event_ticket_price_now(t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule)
     FROM public.event_ticket_types t WHERE t.id = 'c2200000-0000-0000-0000-000000000001') = 10000,
  'cena: warunek wstepny - early bird minal, cena biezaca 10000');
SELECT pg_temp.assert(
  pg_temp.regf_price() = jsonb_build_object('amount_cents', 5000, 'source', 'quote',
    'quote_valid_until', now() + interval '1 hour'),
  'cena: REG-16 - oferta 5000 z chwili zapisu obowiazuje po koncu early birda');
UPDATE public.event_registrations SET quoted_price_cents = 15000
 WHERE id = 'c2400000-0000-0000-0000-000000000001';
SELECT pg_temp.assert((pg_temp.regf_price()->>'amount_cents')::int = 10000,
  'cena: oferta wyzsza od biezacej -> LEAST');
UPDATE public.event_registrations SET quoted_price_cents = 5000, quote_valid_until = now() - interval '1 second'
 WHERE id = 'c2400000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  pg_temp.regf_price() = jsonb_build_object('amount_cents', 10000, 'source', 'current', 'quote_valid_until', NULL),
  'cena: oferta wygasla -> cena biezaca');
UPDATE public.event_registrations SET quoted_currency = 'EUR', quote_valid_until = now() + interval '1 hour'
 WHERE id = 'c2400000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(pg_temp.regf_price()->>'source' = 'current',
  'cena: oferta w innej walucie niz bilet -> cena biezaca');
UPDATE public.event_registrations SET quoted_price_cents = NULL, quoted_currency = NULL, quote_valid_until = NULL
 WHERE id = 'c2400000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  pg_temp.regf_price() = jsonb_build_object('amount_cents', 10000, 'source', 'current', 'quote_valid_until', NULL),
  'cena: brak oferty (zgloszenie sprzed migracji) -> cena biezaca jak dotad');
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_registrations SET quoted_currency = 'PLN', quote_valid_until = now()
      WHERE id = 'c2400000-0000-0000-0000-000000000001'$q$,
  'event_registrations_quote_shape', 'cena: oferta bez kwoty odrzucona przez CHECK');

ROLLBACK;
