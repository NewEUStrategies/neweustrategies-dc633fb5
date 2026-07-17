-- pgTAP: izolacja tenantów dla conversations i conversation_nicknames.
--
-- Uzupełnia chat_personalization_perms_test.sql o twarde asercje na
-- widoczność KROSS-TENANT (ta sama tabela, ale wiersz z innego tenanta):
--
--   1. Bob z tenanta B, który zna po ID rozmowę Alicji z tenanta A, nie
--      widzi jej wiersza w conversations (żadnej kolumny) - polityka
--      conversations_member_select filtruje po tenant_id i członkostwie
--      równocześnie.
--   2. Ta sama zasada dla conversation_nicknames - z innego tenanta count
--      jest 0, nawet gdy pseudonim istnieje.
--   3. Członek TEGO SAMEGO tenanta, który NIE jest w rozmowie, też nie
--      widzi jej wiersza - sam tenant_id nie wystarcza.
--   4. Metatest zakresu ról: obie polityki SELECT są TO authenticated
--      (nie TO public / TO anon) - żadne pole nie wycieka poza zalogowanym
--      członkiem rozmowy.
--   5. anon (nawet gdy rola ma tabelaryczny GRANT SELECT) widzi 0 wierszy w
--      obu tabelach - RLS jest ostatnią linią, kolumny nie wyciekają.
--   6. Zestaw kolumn (whole-row) nie obchodzi RLS: SELECT * jako obcy zwraca
--      0 wierszy tak samo jak SELECT id.

BEGIN;
SELECT plan(14);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a1111111-1111-1111-1111-11111111e6aa', 'iso-tenant-a', 'Iso Tenant A'),
  ('b2222222-2222-2222-2222-22222222e6bb', 'iso-tenant-b', 'Iso Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-00000000e6a1', 'iso-a1@chat.test'),
  ('a0000000-0000-0000-0000-00000000e6a2', 'iso-a2@chat.test'),
  ('a0000000-0000-0000-0000-00000000e6a3', 'iso-a3@chat.test'),
  ('b0000000-0000-0000-0000-00000000e6b1', 'iso-b1@chat.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable) VALUES
  ('a0000000-0000-0000-0000-00000000e6a1', 'iso-a1@chat.test', 'Iso A1', 'a1111111-1111-1111-1111-11111111e6aa', false),
  ('a0000000-0000-0000-0000-00000000e6a2', 'iso-a2@chat.test', 'Iso A2', 'a1111111-1111-1111-1111-11111111e6aa', true),
  ('a0000000-0000-0000-0000-00000000e6a3', 'iso-a3@chat.test', 'Iso A3', 'a1111111-1111-1111-1111-11111111e6aa', true),
  ('b0000000-0000-0000-0000-00000000e6b1', 'iso-b1@chat.test', 'Iso B1', 'b2222222-2222-2222-2222-22222222e6bb', true);

-- A1 zakłada rozmowę z A2 i nadaje jej pseudonim; A3 (ten sam tenant) i B1
-- (inny tenant) NIE są członkami.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000e6a1","role":"authenticated"}', true);
SELECT public.get_or_create_direct_conversation('a0000000-0000-0000-0000-00000000e6a2');
SELECT public.chat_set_appearance(
  (SELECT id FROM public.conversations
    WHERE direct_key = 'a1111111-1111-1111-1111-11111111e6aa'
      || ':a0000000-0000-0000-0000-00000000e6a1'
      || ':a0000000-0000-0000-0000-00000000e6a2'),
  'orchid', 'lines', '🎯'
);
SELECT public.chat_set_nickname(
  (SELECT id FROM public.conversations
    WHERE direct_key = 'a1111111-1111-1111-1111-11111111e6aa'
      || ':a0000000-0000-0000-0000-00000000e6a1'
      || ':a0000000-0000-0000-0000-00000000e6a2'),
  'a0000000-0000-0000-0000-00000000e6a2',
  'Analityczka energetyki'
);

RESET ROLE;
CREATE TEMP TABLE isoconv AS
SELECT id FROM public.conversations
WHERE direct_key = 'a1111111-1111-1111-1111-11111111e6aa'
  || ':a0000000-0000-0000-0000-00000000e6a1'
  || ':a0000000-0000-0000-0000-00000000e6a2';
GRANT SELECT ON isoconv TO authenticated, anon;

-- Superuser widzi rzeczywistość: rozmowa istnieje i ma pseudonim.
SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE id = (SELECT id FROM isoconv)),
  1,
  'baseline: rozmowa istnieje w tabeli (widok superusera)'
);
SELECT is(
  (SELECT count(*)::int FROM public.conversation_nicknames
    WHERE conversation_id = (SELECT id FROM isoconv)),
  1,
  'baseline: pseudonim istnieje w tabeli (widok superusera)'
);

-- ── 1) Kross-tenant: B1 zna id rozmowy, ale RLS nie zwraca ANI JEDNEGO wiersza
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-00000000e6b1","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE id = (SELECT id FROM isoconv)),
  0,
  'kross-tenant: obcy nie widzi wiersza conversations mimo znanego ID'
);

-- SELECT * (whole-row) też zwraca 0 wierszy - żadna kolumna nie wycieka
-- (temat/wallpaper/description/direct_key/quick_emoji).
SELECT is(
  (SELECT count(*)::int FROM (
     SELECT * FROM public.conversations WHERE id = (SELECT id FROM isoconv)
   ) t),
  0,
  'kross-tenant: SELECT * na conversations nie zwraca żadnej kolumny'
);
SELECT is(
  (SELECT count(*)::int FROM public.conversations
    WHERE tenant_id = 'a1111111-1111-1111-1111-11111111e6aa'),
  0,
  'kross-tenant: filtrowanie po cudzym tenant_id też zwraca 0'
);

-- ── 2) Kross-tenant: conversation_nicknames
SELECT is(
  (SELECT count(*)::int FROM public.conversation_nicknames),
  0,
  'kross-tenant: obcy nie widzi żadnego wiersza conversation_nicknames'
);
SELECT is(
  (SELECT count(*)::int FROM (
     SELECT * FROM public.conversation_nicknames
      WHERE conversation_id = (SELECT id FROM isoconv)
   ) t),
  0,
  'kross-tenant: SELECT * na conversation_nicknames nie zwraca żadnej kolumny (bez wycieku pola nickname)'
);

-- ── 3) Ten sam tenant, ale poza rozmową: A3 też nie widzi ──────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000e6a3","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE id = (SELECT id FROM isoconv)),
  0,
  'ten sam tenant, poza rozmową: RLS ukrywa conversations (sam tenant_id nie wystarcza)'
);
SELECT is(
  (SELECT count(*)::int FROM public.conversation_nicknames
    WHERE conversation_id = (SELECT id FROM isoconv)),
  0,
  'ten sam tenant, poza rozmową: RLS ukrywa pseudonimy'
);

-- ── 4) Członek rozmowy widzi swoją rozmowę i pseudonim (kontrola pozytywna)
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000e6a2","role":"authenticated"}', true);
SELECT is(
  (SELECT theme || '/' || wallpaper FROM public.conversations
    WHERE id = (SELECT id FROM isoconv)),
  'orchid/lines',
  'członek widzi wygląd rozmowy, do której należy'
);
SELECT is(
  (SELECT nickname FROM public.conversation_nicknames
    WHERE conversation_id = (SELECT id FROM isoconv)
      AND user_id = 'a0000000-0000-0000-0000-00000000e6a2'),
  'Analityczka energetyki',
  'członek widzi swój pseudonim w rozmowie'
);

-- ── 5) anon: obie tabele zwracają 0 wierszy (RLS ostatnią linią) ───────────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE id = (SELECT id FROM isoconv)),
  0,
  'anon: RLS ukrywa conversations (polityki są TO authenticated)'
);
SELECT is(
  (SELECT count(*)::int FROM public.conversation_nicknames),
  0,
  'anon: RLS ukrywa conversation_nicknames (polityki są TO authenticated)'
);

-- ── 6) Metatest zakresu ról polityk SELECT ────────────────────────────────
RESET ROLE;
SELECT is(
  (SELECT array_agg(rolname::text ORDER BY rolname)
     FROM pg_policy p, unnest(p.polroles) r, pg_roles ro
    WHERE p.polrelid = 'public.conversations'::regclass
      AND p.polname = 'conversations_member_select'
      AND ro.oid = r),
  ARRAY['authenticated'],
  'polityka conversations_member_select ograniczona do roli authenticated (nie public / nie anon)'
);
SELECT is(
  (SELECT array_agg(rolname::text ORDER BY rolname)
     FROM pg_policy p, unnest(p.polroles) r, pg_roles ro
    WHERE p.polrelid = 'public.conversation_nicknames'::regclass
      AND p.polname = 'conversation_nicknames_member_select'
      AND ro.oid = r),
  ARRAY['authenticated'],
  'polityka conversation_nicknames_member_select ograniczona do roli authenticated'
);

SELECT * FROM finish();
ROLLBACK;
