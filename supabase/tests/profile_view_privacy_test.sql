-- pgTAP: tryb widza w "Kto oglądał Twój profil" - zapis, okno godzinne i licznik.
--
-- Weryfikuje migrację 20260913170000_profile_view_privacy_fix.sql.
--
-- PO CO TO STOI. Do 20260913170000 `record_profile_view` sprawdzało powtórzenie
-- po `viewer_id = auth.uid()`, a dla trybu `private` zapisywało w tej kolumnie
-- NULL. Warunek nie miał jak trafić, więc ustawienie prywatności działało
-- DOKŁADNIE ODWROTNIE do swojej etykiety: prywatny widz jako JEDYNY nie
-- podlegał debounce'owi (dziesięć wejść = dziesięć wierszy wobec jednego
-- u widza publicznego), jego wiersze wracały na listę jako "anonim", a licznik
-- 7/30/90 dni liczył każde z nich. Cała powierzchnia `profile_view_events` nie
-- była przy tym dotknięta ANI RAZ przez żaden test pgTAP - trafienia w
-- `network_event_notifications_test.sql` dotyczą wyłącznie preferencji
-- powiadomień (`enabled_profile_view`), nie zapisu odsłon.
--
-- DLACZEGO ASERCJE IDĄ PRZEZ RPC, A NIE PO TABELI. `profile_view_events` ma
-- politykę `pv_no_direct_read` (USING false dla `authenticated`), więc jedyną
-- drogą klienta do tych danych są `my_profile_viewers` i `profile_view_stats`.
-- Test pyta dokładnie tymi dwiema funkcjami, czyli sprawdza to, co realnie
-- zobaczy właściciel profilu - a nie stan tabeli, do której i tak nie zagląda.
-- Liczbę WIERSZY sprawdzamy osobno, po `RESET ROLE`, bo debounce jest
-- twierdzeniem o zapisie i musi być widoczny niezależnie od filtrów odczytu.
--
-- WYZWALACZE UŻYTKOWNIKA WYŁĄCZONE - konwencja tej suity: `on_auth_user_created`
-- woła `handle_new_user()`, który sam zakłada wiersz w `public.profiles`, więc
-- ręczna wstawka padłaby na kluczu głównym przed pierwszą asercją.

BEGIN;
SELECT plan(6);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('e1a11111-1111-1111-1111-111111111111', 'pv-a', 'Profile Views Tenant A', 'a.pv.example');

-- Oglądany O oraz dwaj widzowie: P (private) i U (public).
INSERT INTO auth.users (id, email) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'owner@pv.example'),
  ('e0000000-0000-0000-0000-0000000000b1', 'private@pv.example'),
  ('e0000000-0000-0000-0000-0000000000c1', 'public@pv.example');

INSERT INTO public.profiles (id, email, display_name, tenant_id, profile_view_mode) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'owner@pv.example', 'Owner',
   'e1a11111-1111-1111-1111-111111111111', 'public'),
  ('e0000000-0000-0000-0000-0000000000b1', 'private@pv.example', 'Private Viewer',
   'e1a11111-1111-1111-1111-111111111111', 'private'),
  ('e0000000-0000-0000-0000-0000000000c1', 'public@pv.example', 'Public Viewer',
   'e1a11111-1111-1111-1111-111111111111', 'public');

SET LOCAL ROLE authenticated;

-- ── Widz PRYWATNY wchodzi trzy razy pod rząd ────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.record_profile_view('e0000000-0000-0000-0000-0000000000a1'),
           public.record_profile_view('e0000000-0000-0000-0000-0000000000a1'),
           public.record_profile_view('e0000000-0000-0000-0000-0000000000a1')$$,
  'prywatny: trzy wejścia pod rząd przechodzą bez błędu'
);

-- ── Właściciel profilu nie widzi po nich ANI wiersza, ANI punktu ────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.my_profile_viewers(100)),
  0,
  'prywatny: po trzech wejściach lista widzów jest PUSTA (obietnica ProfileViewsCard)'
);
SELECT is(
  (SELECT last_7 FROM public.profile_view_stats()),
  0,
  'prywatny: licznik 7 dni NIE DRGNĄŁ (przed naprawą rósł o 3)'
);

-- ── Widz PUBLICZNY wchodzi dwa razy w ciągu godziny ─────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.record_profile_view('e0000000-0000-0000-0000-0000000000a1'),
           public.record_profile_view('e0000000-0000-0000-0000-0000000000a1')$$,
  'publiczny: dwa wejścia w ciągu godziny przechodzą bez błędu'
);
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.my_profile_viewers(100)),
  1,
  'publiczny: dwa wejścia w oknie godzinnym dają JEDEN wiersz (debounce działa)'
);

-- ── Dowód po stronie ZAPISU, nie odczytu ────────────────────────────────────
-- Filtr `viewer_mode <> 'private'` przy odczycie sam w sobie dałby te same
-- wyniki wyżej także wtedy, gdyby zapis dalej zakładał trzy wiersze prywatne.
-- Ta asercja rozstrzyga, że ich NIE MA W TABELI: jedyny wiersz pochodzi od
-- widza publicznego.
RESET ROLE;
SELECT results_eq(
  $$SELECT viewer_id, viewer_mode FROM public.profile_view_events
     WHERE profile_id = 'e0000000-0000-0000-0000-0000000000a1'$$,
  $$VALUES ('e0000000-0000-0000-0000-0000000000c1'::uuid, 'public')$$,
  'tabela: prywatny nie zostawia śladu, publiczny zostawia dokładnie jeden'
);

SELECT * FROM finish();
ROLLBACK;
