-- pgTAP: zakup pakietu nie przyjmuje firmy z ladunku kupujacego
-- (migracja 20261007120000_event_package_order_company_not_from_payload).
--
-- DEFEKT (szew TypeScript <-> SQL). `event_package_purchase` (SECURITY
-- DEFINER, EXECUTE dla `authenticated`) wpisywala `company_id` wprost
-- z `p_payload`. Kupujacy wskazywal dowolna firme z kartoteki CRM najemcy:
-- jej nazwa trafiala na liste uczestnikow, rezerwacja miejsc na os czasu
-- firmy, a most faktur (ktory przypina firme z NIP-u tylko na PUSTYM polu)
-- juz nigdy nie poprawial przypiecia. Blad klucza obcego wobec sukcesu byl
-- przy tym wyrocznia identyfikatorow firm. Test atrapy w TS utrwalal ksztalt
-- ladunku z `company_id` - baza tego kontraktu nie sprawdzala.
--
-- CO PRZYPINA: klucz `company_id` (z identyfikatorem istniejacej firmy,
-- nieistniejacej i pustym) to `forbidden_field` PRZED jakimkolwiek zapisem;
-- zakup bez klucza tworzy zamowienie z `company_id` NULL. Od 20261007120600
-- zakup idzie WYLACZNIE z serwera (`event_package_purchase_for_user`, tylko
-- service_role, konto z sesji jawnie) - zasada firmy zostaje ta sama.
BEGIN;
SELECT plan(7);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('ac0a0000-0000-0000-0000-0000000000aa', 'pkg-company-a', 'Pkg Company A', 'pkg-company-a.example');
INSERT INTO auth.users (id, email) VALUES
  ('ac000000-0000-0000-0000-0000000000b1', 'pkg-buyer@example.org');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('ac000000-0000-0000-0000-0000000000b1', 'pkg-buyer@example.org', 'Pkg Buyer',
   'ac0a0000-0000-0000-0000-0000000000aa');

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('ac700000-0000-0000-0000-0000000000c1', 'ac0a0000-0000-0000-0000-0000000000aa', 'Obca Sp. z o.o.');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('ac100000-0000-0000-0000-0000000000e1', 'ac0a0000-0000-0000-0000-0000000000aa',
   'pkg-company-event', 'Kongres', 'Congress', now() + interval '40 days', 'published');
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency) VALUES
  ('ac200000-0000-0000-0000-0000000000f1', 'ac0a0000-0000-0000-0000-0000000000aa',
   'ac100000-0000-0000-0000-0000000000e1', 'pkg_std', 'Standard', 'Standard', 20000, 'PLN');
INSERT INTO public.event_ticket_packages
  (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, audience, seats, price_cents, currency) VALUES
  ('ac500000-0000-0000-0000-0000000000a1', 'ac0a0000-0000-0000-0000-0000000000aa',
   'ac100000-0000-0000-0000-0000000000e1', 'ac200000-0000-0000-0000-0000000000f1',
   'pkg_trojka', 'Pakiet 3', 'Pack of 3', 'public', 3, 54000, 'PLN');

SELECT ok(
  NOT has_function_privilege('anon', 'public.event_package_purchase_for_user(uuid,uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_package_purchase_for_user(uuid,uuid,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_package_purchase_for_user(uuid,uuid,text,jsonb)', 'EXECUTE'),
  'zakup pakietu: tylko service_role (serwer z kontem z sesji), ani anon, ani authenticated');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$SELECT public.event_package_purchase_for_user('ac0a0000-0000-0000-0000-0000000000aa',
      'ac000000-0000-0000-0000-0000000000b1', 'ip:acacacacacacacacacacacacacacacac',
      jsonb_build_object(
      'package_id', 'ac500000-0000-0000-0000-0000000000a1',
      'company_id', 'ac700000-0000-0000-0000-0000000000c1'))$$,
  'P0001', 'forbidden_field: company_id is assigned by the organizer',
  'firma z kartoteki CRM wskazana przez kupujacego: odmowa (dawniej przypinala zamowienie)');
SELECT throws_ok(
  $$SELECT public.event_package_purchase_for_user('ac0a0000-0000-0000-0000-0000000000aa',
      'ac000000-0000-0000-0000-0000000000b1', 'ip:acacacacacacacacacacacacacacacac',
      jsonb_build_object(
      'package_id', 'ac500000-0000-0000-0000-0000000000a1',
      'company_id', 'ac700000-0000-0000-0000-0000000000ff'))$$,
  'P0001', 'forbidden_field: company_id is assigned by the organizer',
  'nieistniejaca firma: TA SAMA odmowa (bez wyroczni 23503 o identyfikatorach CRM)');
SELECT throws_ok(
  $$SELECT public.event_package_purchase_for_user('ac0a0000-0000-0000-0000-0000000000aa',
      'ac000000-0000-0000-0000-0000000000b1', 'ip:acacacacacacacacacacacacacacacac',
      jsonb_build_object(
      'package_id', 'ac500000-0000-0000-0000-0000000000a1', 'company_id', ''))$$,
  'P0001', 'forbidden_field: company_id is assigned by the organizer',
  'pusty klucz company_id to tez blad wolajacego, nie cicha zmiana znaczenia');
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.event_package_orders
    WHERE package_id = 'ac500000-0000-0000-0000-0000000000a1'),
  0,
  'odmowa zapada przed zapisem: ani zamowienia, ani miejsc');

SET LOCAL ROLE service_role;
SELECT ok(
  (public.event_package_purchase_for_user('ac0a0000-0000-0000-0000-0000000000aa',
      'ac000000-0000-0000-0000-0000000000b1', 'ip:acacacacacacacacacacacacacacacac',
      jsonb_build_object(
     'package_id', 'ac500000-0000-0000-0000-0000000000a1',
     'buyer_name', 'Zofia Wierzbicka'))->>'order_id') IS NOT NULL,
  'zakup bez klucza company_id przechodzi');
RESET ROLE;

SELECT is(
  (SELECT company_id FROM public.event_package_orders
    WHERE package_id = 'ac500000-0000-0000-0000-0000000000a1'),
  NULL::uuid,
  'zamowienie powstaje bez firmy - przypina ja organizator (most faktur, panel)');

SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '', true);
SELECT * FROM finish();
ROLLBACK;
