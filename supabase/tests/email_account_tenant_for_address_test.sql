-- pgTAP: najemca KONTA o adresie - rozstrzygnięcie własnościowe dla poczty
-- autoryzacyjnej.
--
-- Weryfikuje migrację 20260913160000_email_account_tenant_for_address.sql.
--
-- PO CO TO STOI. Webhook poczty autoryzacyjnej stemplował wiersz dziennika
-- najemcą z `email_resolve_tenant_for_address`, a ta funkcja rozstrzyga co
-- innego i myliła się w dwie strony: subskrypcja newslettera bije konto, a
-- adres nierozstrzygnięty dostaje tenanta domyślnego zamiast NULL-a. Oba
-- przypadki kończą się cudzym operatorem widzącym SUROWY adres odbiorcy
-- w raporcie systemowym - i oba są tu przypięte wprost, bo różnicy między tymi
-- dwiema funkcjami nie widać z kodu wołającego.
--
-- WYZWALACZE UŻYTKOWNIKA WYŁĄCZONE - konwencja tej suity (accounting_retention,
-- analytics_semantic_layer, anonymous_insert_lockdown): `on_auth_user_created`
-- sam zakłada wiersz w `public.profiles`, więc ręczne wstawienie profilu o tym
-- samym `id` padłoby na kluczu głównym przed pierwszą asercją.

BEGIN;
SELECT plan(5);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('e1111111-1111-4111-8111-111111111111', 'tenant-a', 'Tenant A'),
  ('e2222222-2222-4222-8222-222222222222', 'tenant-b', 'Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('e3333333-0000-4333-0000-333333333333', 'konto-b@x.test'),
  ('e4444444-0000-4444-0000-444444444444', 'dwa-konta@x.test'),
  ('e5555555-0000-4555-0000-555555555555', 'dwa-konta2@x.test');

-- SEDNO PIERWSZEGO PRZYPADKU: ten sam adres jest subskrybentem newslettera
-- u najemcy A, a KONTEM u najemcy B. Mail autoryzacyjny dotyczy konta.
INSERT INTO public.newsletter_subscribers (tenant_id, email) VALUES
  ('e1111111-1111-4111-8111-111111111111', 'konto-b@x.test');

INSERT INTO public.profiles (id, tenant_id, email) VALUES
  ('e3333333-0000-4333-0000-333333333333', 'e2222222-2222-4222-8222-222222222222', 'konto-b@x.test');

SELECT is(
  public.email_account_tenant_for_address('konto-b@x.test'),
  'e2222222-2222-4222-8222-222222222222'::uuid,
  'KONTO bije subskrypcję newslettera - mail autoryzacyjny dotyczy konta'
);

-- Kontrola, że przypadek jest realny: stara funkcja faktycznie oddaje TU
-- najemcę subskrypcji. Bez tej asercji test przechodziłby też wtedy, gdyby
-- obie funkcje robiły to samo, i nie dowodziłby niczego o różnicy.
SELECT is(
  public.email_resolve_tenant_for_address('konto-b@x.test'),
  'e1111111-1111-4111-8111-111111111111'::uuid,
  'email_resolve_tenant_for_address oddaje TU subskrypcję - dlatego nie wolno jej użyć do własności'
);

SELECT is(
  public.email_account_tenant_for_address('nikt@x.test'),
  NULL,
  'adres bez konta daje NULL, a NIE tenanta domyślnego - dopiero NULL wpuszcza host powrotu'
);

-- Ta sama kontrola dla drugiej strony pomyłki. Porównujemy z
-- `email_default_tenant_id()`, a NIE z `isnt(..., NULL)`: ta funkcja oddaje
-- tenanta oznaczonego `is_default`, a gdy takiego nie ma przy wielu najemcach -
-- NULL. Asercja „nie NULL" wiązałaby więc test z zaszczepieniem tenanta
-- domyślnego w bazie pgTAP, czyli z czymś, o czym ten test nie jest. Tak
-- zapisana mówi dokładnie to, co trzeba: stara funkcja kończy FALLBACKIEM,
-- nie odpowiedzią „nie wiadomo".
SELECT is(
  public.email_resolve_tenant_for_address('nikt@x.test'),
  public.email_default_tenant_id(),
  'email_resolve_tenant_for_address kończy fallbackiem na tenanta domyślnego - zamyka gałąź zapasową wołającego'
);

INSERT INTO public.profiles (id, tenant_id, email) VALUES
  ('e4444444-0000-4444-0000-444444444444', 'e1111111-1111-4111-8111-111111111111', 'dwa-konta@x.test'),
  ('e5555555-0000-4555-0000-555555555555', 'e2222222-2222-4222-8222-222222222222', 'dwa-konta@x.test');

SELECT is(
  public.email_account_tenant_for_address('dwa-konta@x.test'),
  NULL,
  'adres z kontami u DWÓCH najemców jest wieloznaczny - NULL, nie zgadywanie'
);

SELECT * FROM finish();
ROLLBACK;
