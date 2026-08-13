-- pgTAP: paczka RODO nie moze zawierac wiersza cudzej osoby.
--
-- CZEGO TO DOWODZI I PO CO. `src/lib/profile/export.functions.ts` sklada eksport
-- danych osobowych z 33 zapytan. Trzydziesci jeden ma JAWNY filtr wlasciciela
-- w kodzie (`.eq("user_id", userId)` albo inna kolumna wlasciciela). Dwa go NIE
-- MAJA i polegaja wylacznie na RLS: `conversations` i `notifications`.
--
-- Bramka statyczna `src/lib/profile/__tests__/exportOwnerScope.gate.test.ts`
-- trzyma liste tych dwoch wyjatkow, ale sama nie umie sprawdzic, czy RLS
-- naprawde zawezá - czyta kod TypeScriptu, nie polityki bazy. Bez tego pliku
-- lista wyjatkow byla by OBIETNICA BEZ POKRYCIA: wystarczyloby, zeby ktos
-- rozluznil polityke `notifications_select_own`, i eksport zaczalby wypuszczac
-- powiadomienia wszystkich, nie zapalajac zadnego testu.
--
-- Konsekwencja tej awarii jest prawna (art. 15 i 32 RODO), nie funkcjonalna -
-- dlatego dowod idzie po stronie bazy, na realnych rolach i realnym RLS.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(12);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwoch uzytkownikow w JEDNYM najemcy ───────────────────────────────
-- Ten sam najemca jest tu SUROWSZYM testem niz dwa: gdyby zawezenie opieralo sie
-- tylko na `tenant_id`, para w jednym najemcy przeszlaby przez nie swobodnie.
INSERT INTO public.tenants (id, slug, name)
VALUES ('11111111-1111-1111-1111-111111111111', 'exp-scope', 'Export scope')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner@exp.test', '{}'::jsonb),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'other@exp.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Wlasciciel'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Ktos inny')
ON CONFLICT (id) DO NOTHING;

-- ── (1-2) RLS jest WLACZONY na obu tabelach wyjatkow ────────────────────────
-- Wylaczony RLS przy braku filtru w kodzie = eksport bez zawezenia. Sprawdzamy to
-- osobno od polityk, bo polityka bez `ENABLE` nie obowiazuje.
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notifications'::regclass),
  'notifications: RLS wlaczony (eksport nie ma tu filtru w kodzie)'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.conversations'::regclass),
  'conversations: RLS wlaczony (eksport nie ma tu filtru w kodzie)'
);

-- ── (3-4) Rola `anon` nie ma czego szukac w zadnej z nich ───────────────────
SELECT ok(
  NOT has_table_privilege('anon', 'public.notifications', 'SELECT'),
  'notifications: anon NIE ma SELECT'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.conversations', 'SELECT'),
  'conversations: anon NIE ma SELECT'
);

-- ── (5-8) notifications: wlasciciel widzi swoje, NIE widzi cudzych ──────────
INSERT INTO public.notifications (user_id, tenant_id, kind, title_pl, title_en)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'system', 'Moje powiadomienie', 'My notification'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'system', 'Cudze powiadomienie', 'Other notification');

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

-- ASERCJA NA WLASNOSCI BEZPIECZENSTWA, NIE NA LICZBIE WIERSZY. Pierwsza wersja
-- tego testu sprawdzala `count(*) = 1` i OBLALA - bo trigger zakladania profilu
-- dopisuje powiadomienie powitalne, wiec wlasciciel ma ich dwa. RLS dzialal
-- poprawnie; zla byla asercja. Liczba wierszy zalezy od cudzych triggerow,
-- a pytanie brzmi: czy w moim eksporcie moze znalezc sie CUDZY wiersz.
SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE user_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'notifications: wlasciciel nie widzi ANI JEDNEGO wiersza drugiej osoby'
);
SELECT ok(
  (SELECT count(*)::int FROM public.notifications
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001') > 0,
  'notifications: wlasciciel widzi swoje wiersze (sciezka legalna dziala)'
);
SELECT is(
  (SELECT count(DISTINCT user_id)::int FROM public.notifications),
  1,
  'notifications: KAZDY widziany wiersz nalezy do jednego uzytkownika - wolajacego'
);

-- Ta sama tabela z perspektywy drugiej osoby - symetria zawezenia.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'notifications: druga osoba nie widzi wierszy wlasciciela'
);

-- ── (9-11) conversations: bez czlonkostwa nie ma wgladu ─────────────────────
RESET ROLE;
INSERT INTO public.conversations (id, tenant_id, kind, created_by)
VALUES ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
        'direct', 'bbbbbbbb-0000-0000-0000-000000000002');
INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id)
VALUES ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111');

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SELECT is(
  (SELECT count(*)::int FROM public.conversations
   WHERE id = 'cccccccc-0000-0000-0000-000000000003'),
  0,
  'conversations: nie-czlonek nie widzi rozmowy (eksport nie wyniesie jej metadanych)'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SELECT is(
  (SELECT count(*)::int FROM public.conversations
   WHERE id = 'cccccccc-0000-0000-0000-000000000003'),
  1,
  'conversations: czlonek widzi swoja rozmowe (sciezka legalna dziala)'
);

-- Zawezenie nie moze opierac sie na samym najemcy - oba konta sa w tym samym.
SELECT is(
  (SELECT count(DISTINCT tenant_id)::int FROM public.profiles
   WHERE id IN ('aaaaaaaa-0000-0000-0000-000000000001',
                'bbbbbbbb-0000-0000-0000-000000000002')),
  1,
  'seed: oba konta sa w JEDNYM najemcy, wiec test nie przechodzi przez tenant_id'
);

-- ── (12) Polityka SELECT na notifications wiaze sie z auth.uid() ────────────
RESET ROLE;
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND cmd = 'SELECT'
      AND qual LIKE '%uid()%'
      AND qual LIKE '%user_id%'
  ),
  'notifications: polityka SELECT wiaze wiersz z auth.uid(), nie z sama rola'
);

SELECT * FROM finish();
ROLLBACK;
