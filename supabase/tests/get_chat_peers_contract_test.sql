-- pgTAP: pełny kontrakt prywatności RPC get_chat_peers (P0, regresja 21.07).
--
-- KONTEKST: migracje 20260721211451/211552, dodając kolumnę slug przez
-- DROP/CREATE, zdmuchnęły hardening z 20260712190000 - user tenanta B
-- enumerował po UUID profile discoverable tenanta A, zniknął guard
-- auth.uid() i limit rozmiaru wejścia, a default ACL przywrócił EXECUTE
-- dla anon. Przywrócenie: migracja 20260731210000.
--
-- Plik jest CELOWO samowystarczalny: seed wyłącznie bezpośrednimi INSERT-ami
-- (zero RPC czatu, storage i preferencji), więc wynik zależy tylko od
-- kontraktu get_chat_peers. Starsze fixture'y czatu (m.in.
-- chat_privacy_isolation_test.sql) wołają get_or_create_direct_conversation,
-- które po bramkach sieci kontaktów i warstw członkostwa (21-25.07) rzuca
-- na ich seedzie - te pliki przerywają się przed asercjami get_chat_peers
-- i wymagają osobnej rundy naprawczej.
--
-- Macierz widoczności (wołający -> profil):
--   1. self: zawsze widoczny (także nie-discoverable) + slug w zwrotce;
--   2. ten sam tenant + discoverable: widoczny;
--   3. ten sam tenant + nie-discoverable + wspólna konwersacja: widoczny;
--   4. ten sam tenant + nie-discoverable + brak konwersacji: ukryty;
--   5. inny tenant + discoverable + wspólna LEGACY konwersacja: ukryty
--      (dokładnie ta regresja wyciekała profile cross-tenant);
--   6. inny tenant + discoverable + brak konwersacji: ukryty;
--   7. limit wejścia: pusta tablica i tablica > 200 id odrzucone w całości;
--   8. guard auth.uid(): sesja bez sub nie czyta nic;
--   9. ACL: anon bez EXECUTE, authenticated i service_role z EXECUTE.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(12);

-- ── Seed (wyłącznie superuser, bez RPC) ─────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a7000000-0000-0000-0000-00000000000a', 'peers-tenant-a', 'Peers Tenant A'),
  ('b7000000-0000-0000-0000-00000000000b', 'peers-tenant-b', 'Peers Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('a7000000-0000-0000-0000-0000000000a1', 'a1@peers.test'),
  ('a7000000-0000-0000-0000-0000000000a2', 'a2@peers.test'),
  ('a7000000-0000-0000-0000-0000000000a3', 'a3@peers.test'),
  ('a7000000-0000-0000-0000-0000000000a4', 'a4@peers.test'),
  ('b7000000-0000-0000-0000-0000000000b1', 'b1@peers.test');

-- Slug jak w realnym provisioningu (profiles_generate_unique_slug) - asercja
-- kontraktu zwrotki wymaga niepustej wartości.
INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable, slug) VALUES
  ('a7000000-0000-0000-0000-0000000000a1', 'a1@peers.test', 'Peer A1', 'a7000000-0000-0000-0000-00000000000a', false, 'peer-a1'),
  ('a7000000-0000-0000-0000-0000000000a2', 'a2@peers.test', 'Peer A2', 'a7000000-0000-0000-0000-00000000000a', true,  'peer-a2'),
  ('a7000000-0000-0000-0000-0000000000a3', 'a3@peers.test', 'Peer A3', 'a7000000-0000-0000-0000-00000000000a', true,  'peer-a3'),
  ('a7000000-0000-0000-0000-0000000000a4', 'a4@peers.test', 'Peer A4', 'a7000000-0000-0000-0000-00000000000a', false, 'peer-a4'),
  ('b7000000-0000-0000-0000-0000000000b1', 'b1@peers.test', 'Peer B1', 'b7000000-0000-0000-0000-00000000000b', true,  'peer-b1');

-- Wspólny wątek tenanta A: A1 + A2 + A4 oraz LEGACY cross-tenant wiersz
-- członkostwa B1 (user tenanta B "wszczepiony" do konwersacji tenanta A -
-- historyczny stan danych, który przed hardeningiem ujawniał profile).
INSERT INTO public.conversations (id, tenant_id, kind, created_by) VALUES
  ('c7000000-0000-0000-0000-0000000000c1', 'a7000000-0000-0000-0000-00000000000a', 'group',
   'a7000000-0000-0000-0000-0000000000a1');

INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id) VALUES
  ('c7000000-0000-0000-0000-0000000000c1', 'a7000000-0000-0000-0000-0000000000a1', 'a7000000-0000-0000-0000-00000000000a'),
  ('c7000000-0000-0000-0000-0000000000c1', 'a7000000-0000-0000-0000-0000000000a2', 'a7000000-0000-0000-0000-00000000000a'),
  ('c7000000-0000-0000-0000-0000000000c1', 'a7000000-0000-0000-0000-0000000000a4', 'a7000000-0000-0000-0000-00000000000a'),
  ('c7000000-0000-0000-0000-0000000000c1', 'b7000000-0000-0000-0000-0000000000b1', 'a7000000-0000-0000-0000-00000000000a');

-- ── Widoczność w tenancie wołającego ────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a7000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT gp.slug FROM public.get_chat_peers(
     ARRAY['a7000000-0000-0000-0000-0000000000a1']::uuid[]) gp),
  'peer-a1',
  'self: własny nie-discoverable profil widoczny, kolumna slug (21.07) w zwrotce'
);

SELECT results_eq(
  $$SELECT id FROM public.get_chat_peers(ARRAY[
      'a7000000-0000-0000-0000-0000000000a2',
      'a7000000-0000-0000-0000-0000000000a3',
      'b7000000-0000-0000-0000-0000000000b1']::uuid[])
    ORDER BY display_name$$,
  $$VALUES ('a7000000-0000-0000-0000-0000000000a2'::uuid),
           ('a7000000-0000-0000-0000-0000000000a3'::uuid)$$,
  'discoverable peers wyłącznie z tenanta wołającego (B1 odfiltrowany mimo discoverable i wspólnej legacy konwersacji)'
);

SELECT is(
  (SELECT count(*)::int FROM public.get_chat_peers(
     ARRAY['a7000000-0000-0000-0000-0000000000a4']::uuid[])),
  1,
  'nie-discoverable współuczestnik konwersacji w tenancie widoczny (gałąź EXISTS)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a7000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.get_chat_peers(
     ARRAY['a7000000-0000-0000-0000-0000000000a4']::uuid[])),
  0,
  'nie-discoverable bez wspólnej konwersacji ukryty także w tym samym tenancie'
);

-- ── Filtr tenanta (anty-regresja 21.07) ─────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.get_chat_peers(
     ARRAY['a7000000-0000-0000-0000-0000000000a2']::uuid[])),
  0,
  'filtr tenanta: B1 nie widzi discoverable A2 mimo wspólnej legacy konwersacji'
);

SELECT is(
  (SELECT count(*)::int FROM public.get_chat_peers(
     ARRAY['a7000000-0000-0000-0000-0000000000a3']::uuid[])),
  0,
  'filtr tenanta: B1 nie widzi discoverable A3 (bez wspólnej konwersacji)'
);

-- ── Limit rozmiaru wejścia ──────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a7000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.get_chat_peers(ARRAY[]::uuid[])),
  0,
  'limit wejścia: pusta tablica nie zwraca żadnych profili'
);

SELECT is(
  (SELECT count(*)::int FROM public.get_chat_peers(
     (SELECT array_agg(ids.u)
        FROM (SELECT 'a7000000-0000-0000-0000-0000000000a2'::uuid AS u
              UNION ALL
              SELECT gen_random_uuid() FROM generate_series(1, 200)) ids))),
  0,
  'limit wejścia: tablica > 200 id odrzucona w całości (realny id w środku nie wycieka)'
);

-- ── Guard auth.uid() ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.get_chat_peers(
     ARRAY['a7000000-0000-0000-0000-0000000000a2']::uuid[])),
  0,
  'guard auth.uid(): sesja bez sub nie czyta nawet profili discoverable'
);

-- ── ACL (DROP/CREATE nie może przywrócić default ACL dla anon) ──────────────
RESET ROLE;

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_chat_peers(uuid[])', 'EXECUTE'),
  'anon bez EXECUTE na get_chat_peers'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.get_chat_peers(uuid[])', 'EXECUTE'),
  'authenticated ma EXECUTE na get_chat_peers'
);

SELECT ok(
  has_function_privilege('service_role', 'public.get_chat_peers(uuid[])', 'EXECUTE'),
  'service_role ma EXECUTE na get_chat_peers'
);

SELECT * FROM finish();
ROLLBACK;
