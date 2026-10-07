-- pgTAP: kod dostepu do wejsciowki - limit prob, ktory wiaze
-- (migracja 20261007140400_ticket_access_code_probe).
--
-- DEFEKT. Kod dostepu (prasa, partnerzy, zaproszenia) mial dwie wyrocznie:
-- `event_ticket_checkout_quote` (authenticated, bez licznika) i `event_register`
-- (anon), w ktorej licznik byl kluczowany e-mailem z ladunku, a pudlo konczylo
-- sie wyjatkiem wycofujacym zapis licznika.
--
-- CO PRZYPINA:
--   * ACL - wycena kasy tylko dla service_role, zapis publiczny zostaje anon;
--   * wycena: pudlo wraca WARTOSCIA i jest zliczone w kubelku biletu, konta
--     i adresu; pusty kod nie jest proba; dobry kod nie zjada kubelka; pelny
--     kubelek konta, adresu (farma kont) albo biletu odmawia takze dobremu
--     kodowi;
--   * zapis: pudlo wraca wartoscia, zlicza kubelek biletu, licznik zapisu
--     zostaje (bez wycofania), zgloszenie nie powstaje; pelny kubelek biletu
--     odmawia takze dobremu kodowi.
--
-- now() jest staly w transakcji, wiec wszystkie proby siedza w jednym oknie.
BEGIN;
SELECT plan(26);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('ac0a0000-0000-0000-0000-0000000000aa', 'tacp-a', 'Access Code A', 'tacp-a.example');

INSERT INTO auth.users (id, email) VALUES
  ('ac000000-0000-0000-0000-0000000000a1', 'tacp-u1@example.org'),
  ('ac000000-0000-0000-0000-0000000000a2', 'tacp-u2@example.org'),
  ('ac000000-0000-0000-0000-0000000000a3', 'tacp-u3@example.org');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('ac000000-0000-0000-0000-0000000000a1', 'tacp-u1@example.org', 'TACP U1', 'ac0a0000-0000-0000-0000-0000000000aa'),
  ('ac000000-0000-0000-0000-0000000000a2', 'tacp-u2@example.org', 'TACP U2', 'ac0a0000-0000-0000-0000-0000000000aa'),
  ('ac000000-0000-0000-0000-0000000000a3', 'tacp-u3@example.org', 'TACP U3', 'ac0a0000-0000-0000-0000-0000000000aa');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('ac100000-0000-0000-0000-0000000000e1', 'ac0a0000-0000-0000-0000-0000000000aa',
   'tacp-event', 'TACP', 'TACP', '2030-06-10 08:00+00', 'published');

-- f1: bezplatna dla prasy (zapis anonimowy), f2: platna VIP (kasa),
-- f3: platna partnerska (kubelek biletu pelny).
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency, access_code_hash) VALUES
  ('ac200000-0000-0000-0000-0000000000f1', 'ac0a0000-0000-0000-0000-0000000000aa',
   'ac100000-0000-0000-0000-0000000000e1', 'tacp_press', 'Prasa', 'Press', 0, 'PLN',
   encode(extensions.digest('PRESS2026', 'sha256'), 'hex')),
  ('ac200000-0000-0000-0000-0000000000f2', 'ac0a0000-0000-0000-0000-0000000000aa',
   'ac100000-0000-0000-0000-0000000000e1', 'tacp_vip', 'VIP', 'VIP', 10000, 'PLN',
   encode(extensions.digest('VIP2026', 'sha256'), 'hex')),
  ('ac200000-0000-0000-0000-0000000000f3', 'ac0a0000-0000-0000-0000-0000000000aa',
   'ac100000-0000-0000-0000-0000000000e1', 'tacp_partner', 'Partner', 'Partner', 10000, 'PLN',
   encode(extensions.digest('PARTNER', 'sha256'), 'hex'));

-- ── 1-6. Uprawnienia ────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.event_ticket_checkout_quote(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_ticket_checkout_quote(uuid,text)', 'EXECUTE'),
  'event_ticket_checkout_quote: bez EXECUTE dla klienta (byla wyrocznia dla authenticated)');
SELECT ok(
  NOT has_function_privilege('anon', 'public.event_ticket_checkout_quote_for_user(uuid,uuid,text,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_ticket_checkout_quote_for_user(uuid,uuid,text,uuid,text)', 'EXECUTE'),
  'event_ticket_checkout_quote_for_user: bez EXECUTE dla klienta');
SELECT ok(has_function_privilege('service_role', 'public.event_ticket_checkout_quote_for_user(uuid,uuid,text,uuid,text)', 'EXECUTE'),
  'event_ticket_checkout_quote_for_user: service_role (kasa)');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public._event_ticket_checkout_quote(uuid,uuid,text,uuid,text)', 'EXECUTE'),
  'rdzen wyceny niedostepny dla klienta');
SELECT ok(
  NOT has_function_privilege('anon', 'public._access_code_probe_guard(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._access_code_probe_miss(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._access_code_probe_miss(uuid,uuid,text)', 'EXECUTE'),
  'kubelki kodu dostepu niedostepne dla klienta');
SELECT ok(has_function_privilege('anon', 'public.event_register(jsonb)', 'EXECUTE'),
  'event_register zostaje publiczny (zapis bez konta to jego zadanie)');

-- ── 7-13. Wycena kasy (service_role, konto u1, adres A) ───────────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  public.event_ticket_checkout_quote_for_user('ac0a0000-0000-0000-0000-0000000000aa',
    'ac000000-0000-0000-0000-0000000000a1', 'ip:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'ac200000-0000-0000-0000-0000000000f2', 'GUESS-1') ->> 'error',
  'ticket_access_code_invalid',
  'pudlo wraca WARTOSCIA (wyjatek wycofywal zliczenie)');
RESET ROLE;
SELECT is(
  (SELECT count FROM public.rate_limits WHERE scope = 'access_code_miss.ticket'
     AND subject_id = 'ticket:ac200000-0000-0000-0000-0000000000f2'),
  1, 'pudlo zliczone w kubelku BILETU');
SELECT is(
  (SELECT count FROM public.rate_limits WHERE scope = 'coupon_probe_miss'
     AND subject_id = 'user:ac000000-0000-0000-0000-0000000000a1'),
  1, 'pudlo zliczone w kubelku KONTA (wspolnym z kodami rabatowymi)');
SELECT is(
  (SELECT count FROM public.rate_limits WHERE scope = 'coupon_probe_miss.ip'
     AND subject_id = 'ip:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  1, 'pudlo zliczone w kubelku ADRESU');

SET LOCAL ROLE service_role;
SELECT is(
  public.event_ticket_checkout_quote_for_user('ac0a0000-0000-0000-0000-0000000000aa',
    'ac000000-0000-0000-0000-0000000000a1', 'ip:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'ac200000-0000-0000-0000-0000000000f2', '  ') ->> 'error',
  'ticket_access_code_invalid',
  'pusty kod: odmowa');
SELECT is(
  (public.event_ticket_checkout_quote_for_user('ac0a0000-0000-0000-0000-0000000000aa',
    'ac000000-0000-0000-0000-0000000000a1', 'ip:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'ac200000-0000-0000-0000-0000000000f2', ' vip2026 ') ->> 'amount_cents')::integer,
  10000,
  'dobry kod (bez wielkosci liter i spacji): pelna wycena');
RESET ROLE;
SELECT is(
  (SELECT count FROM public.rate_limits WHERE scope = 'access_code_miss.ticket'
     AND subject_id = 'ticket:ac200000-0000-0000-0000-0000000000f2'),
  1, 'pusty kod i trafienie NIE zjadaja kubelka');

-- ── 14-15. 30 pudel konta: odmowa takze dobremu kodowi ────────────────────
SET LOCAL ROLE service_role;
SELECT public.event_ticket_checkout_quote_for_user('ac0a0000-0000-0000-0000-0000000000aa',
    'ac000000-0000-0000-0000-0000000000a1', 'ip:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'ac200000-0000-0000-0000-0000000000f2', 'GUESS-' || g)
  FROM generate_series(2, 30) g;
RESET ROLE;
SELECT is(
  (SELECT count FROM public.rate_limits WHERE scope = 'coupon_probe_miss'
     AND subject_id = 'user:ac000000-0000-0000-0000-0000000000a1'),
  30, '30 pudel konta zliczonych');
SET LOCAL ROLE service_role;
SELECT throws_like(
  $$SELECT public.event_ticket_checkout_quote_for_user('ac0a0000-0000-0000-0000-0000000000aa',
      'ac000000-0000-0000-0000-0000000000a1', 'ip:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'ac200000-0000-0000-0000-0000000000f2', 'VIP2026')$$,
  'rate_limited%',
  'po 30 pudlach konta DOBRY kod tez dostaje odmowe (brak wyroczni roznicy)');
RESET ROLE;

-- ── 16. Farma kont za jednym adresem: kubelek adresu ──────────────────────
UPDATE public.rate_limits SET count = 120
 WHERE scope = 'coupon_probe_miss.ip' AND subject_id = 'ip:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
SET LOCAL ROLE service_role;
SELECT throws_like(
  $$SELECT public.event_ticket_checkout_quote_for_user('ac0a0000-0000-0000-0000-0000000000aa',
      'ac000000-0000-0000-0000-0000000000a2', 'ip:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'ac200000-0000-0000-0000-0000000000f2', 'VIP2026')$$,
  'rate_limited%',
  'swieze konto za tym samym adresem (120 pudel adresu): odmowa');
RESET ROLE;

-- ── 17-18. Kubelek biletu: 60 pudel z dowolnych kont i adresow ────────────
INSERT INTO public.rate_limits (scope, subject_id, window_start, count)
VALUES ('access_code_miss.ticket', 'ticket:ac200000-0000-0000-0000-0000000000f3',
        to_timestamp((floor(extract(epoch FROM now()) / 600) * 600)::double precision), 60);
SET LOCAL ROLE service_role;
SELECT throws_like(
  $$SELECT public.event_ticket_checkout_quote_for_user('ac0a0000-0000-0000-0000-0000000000aa',
      'ac000000-0000-0000-0000-0000000000a3', 'ip:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'ac200000-0000-0000-0000-0000000000f3', 'PARTNER')$$,
  'rate_limited%',
  'pelny kubelek BILETU: odmowa takze swiezemu kontu z nowym adresem');
SELECT throws_like(
  $$SELECT public.event_ticket_checkout_quote_for_user('ac0a0000-0000-0000-0000-0000000000aa',
      'ac000000-0000-0000-0000-0000000000a3', 'not-a-hash', 'ac200000-0000-0000-0000-0000000000f3', 'PARTNER')$$,
  'invalid_payload%',
  'podmiot adresu musi byc solonym skrotem (ip:<32 hex>), nie surowym adresem');
RESET ROLE;

-- ── 19-26. Zapis publiczny (anon) ──────────────────────────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"tacp-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT is(
  public.event_register(jsonb_build_object(
    'event_slug', 'tacp-event', 'ticket_type_id', 'ac200000-0000-0000-0000-0000000000f1',
    'first_name', 'Anna', 'last_name', 'Proba', 'email', 'tacp-guess@example.org',
    'consent_data_processing', true, 'access_code', 'GUESS')) ->> 'error',
  'invalid_access_code',
  'zapis: pudlo wraca wartoscia, nie wyjatkiem');
SELECT is(
  public.event_register(jsonb_build_object(
    'event_slug', 'tacp-event', 'ticket_type_id', 'ac200000-0000-0000-0000-0000000000f1',
    'first_name', 'Anna', 'last_name', 'Proba', 'email', 'tacp-guess2@example.org',
    'consent_data_processing', true)) ->> 'error',
  'invalid_access_code',
  'zapis bez kodu: odmowa');
RESET ROLE;
SELECT is(
  (SELECT count FROM public.rate_limits WHERE scope = 'access_code_miss.ticket'
     AND subject_id = 'ticket:ac200000-0000-0000-0000-0000000000f1'),
  1, 'zapis: pudlo zliczone w kubelku biletu (klucz z bazy, nie z ladunku); brak kodu nie liczy sie');
SELECT is(
  (SELECT sum(count)::int FROM public.rate_limits WHERE scope = 'event_register'
     AND subject_id LIKE 'ac0a0000-0000-0000-0000-0000000000aa:%'),
  2, 'licznik zapisu ZOSTAJE po pudle (wyjatek go wycofywal)');
SELECT is(
  (SELECT count(*)::int FROM public.event_registrations
    WHERE ticket_type_id = 'ac200000-0000-0000-0000-0000000000f1'),
  0, 'pudlo nie tworzy zgloszenia');

SET LOCAL ROLE anon;
SELECT ok(
  (public.event_register(jsonb_build_object(
    'event_slug', 'tacp-event', 'ticket_type_id', 'ac200000-0000-0000-0000-0000000000f1',
    'first_name', 'Piotr', 'last_name', 'Prasa', 'email', 'tacp-press@example.org',
    'consent_data_processing', true, 'access_code', 'press2026')) ->> 'registration_id') IS NOT NULL,
  'zapis z dobrym kodem przechodzi');
RESET ROLE;
SELECT is(
  (SELECT count FROM public.rate_limits WHERE scope = 'access_code_miss.ticket'
     AND subject_id = 'ticket:ac200000-0000-0000-0000-0000000000f1'),
  1, 'trafienie nie zjada kubelka biletu');

UPDATE public.rate_limits SET count = 60
 WHERE scope = 'access_code_miss.ticket' AND subject_id = 'ticket:ac200000-0000-0000-0000-0000000000f1';
SET LOCAL ROLE anon;
SELECT throws_like(
  $$SELECT public.event_register(jsonb_build_object(
      'event_slug', 'tacp-event', 'ticket_type_id', 'ac200000-0000-0000-0000-0000000000f1',
      'first_name', 'Ewa', 'last_name', 'Prasa', 'email', 'tacp-press2@example.org',
      'consent_data_processing', true, 'access_code', 'PRESS2026'))$$,
  'rate_limited%',
  'pelny kubelek biletu: zapis z DOBRYM kodem tez odmowiony (rotacja e-maili nie pomaga)');
RESET ROLE;

SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
