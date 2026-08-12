-- pgTAP: dowod zgody RODO jest niepodrabialny i nie przekracza granicy najemcy.
--
-- Dwa findingi audytu modulu 19, jedna powierzchnia (rejestr zgod):
--
--   K2  Rola `authenticated` miala GRANT INSERT/UPDATE/DELETE na
--       `user_consents` i INSERT na `user_consent_events` plus permisywne
--       polityki own-row (20260717095322, przywrocone 20260802155237). Klient
--       mogl wiec DOPISAC zgode, ktorej nigdy nie wyrazil, ZMIENIC stan bez
--       wpisu w dzienniku (rozjazd stanu z dowodem) i USUNAC wlasny dowod -
--       czyli sfalszowac material dowodowy art. 7 ust. 1 RODO. Zamkniete
--       migracja 20260803190927: granty i polityki zapisu zdjete, zapis idzie
--       WYLACZNIE przez SECURITY DEFINER `set_user_consent`, ktora sama ustala
--       `user_id`, `tenant_id` i znaczniki czasu. Ten plik przybija stan
--       koncowy (granty + polityki + zachowanie) razem ze scieżka legalna:
--       lockdown bez dowodu, ze zapis nadal dziala, jest tylko awaria.
--
--   K4  `admin_get_user_consent/1` (20260715214120) autoryzowala rola, ale
--       czytala wiersz `profiles` po samym `id`, wiec admin najemcy A odczytywal
--       lustro CMP uzytkownika najemcy B. Zamkniete migracja 20260812090000
--       (`p.tenant_id = public.current_tenant_id()`).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(28);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwa najemcy, admin w A, czlonkowie w A i B ────────────────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('ce111111-1111-1111-1111-111111111111', 'consent-a', 'Consent Tenant A'),
  ('ce222222-2222-2222-2222-222222222222', 'consent-b', 'Consent Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('ce0a0000-0000-0000-0000-0000000000a1', 'admin-a@consent.test'),
  ('ce0a0000-0000-0000-0000-0000000000a2', 'member-a@consent.test'),
  ('ce0b0000-0000-0000-0000-0000000000b1', 'member-b@consent.test');

-- `prefs->'consent'` to lustro CMP czytane przez panel admina - rozne wartosci
-- w A i B, zeby przeciek dal sie odroznic od pustej zwrotki.
INSERT INTO public.profiles (id, email, display_name, tenant_id, prefs) VALUES
  ('ce0a0000-0000-0000-0000-0000000000a1', 'admin-a@consent.test', 'Admin A',
   'ce111111-1111-1111-1111-111111111111', '{}'::jsonb),
  ('ce0a0000-0000-0000-0000-0000000000a2', 'member-a@consent.test', 'Member A',
   'ce111111-1111-1111-1111-111111111111',
   '{"consent":{"categories":{"necessary":true,"analytics":false},"version":"2026-01"}}'::jsonb),
  ('ce0b0000-0000-0000-0000-0000000000b1', 'member-b@consent.test', 'Member B',
   'ce222222-2222-2222-2222-222222222222',
   '{"consent":{"categories":{"necessary":true,"analytics":true},"version":"2026-02"}}'::jsonb);

-- Admin wylacznie w najemcy A (has_role zakresowany current_tenant_id()).
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('ce0a0000-0000-0000-0000-0000000000a1', 'admin'::public.app_role,
   'ce111111-1111-1111-1111-111111111111');

-- ── 1. Granty: rola kliencka czyta rejestr, ale go nie pisze ────────────────
SELECT ok(
  NOT has_table_privilege('anon', 'public.user_consents', 'INSERT'),
  'anon NIE ma grantu INSERT do user_consents'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.user_consents', 'INSERT'),
  'authenticated NIE ma grantu INSERT do user_consents (dopisanie zgody niemozliwe)'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.user_consents', 'UPDATE'),
  'authenticated NIE ma grantu UPDATE do user_consents (stan bez wpisu w dzienniku niemozliwy)'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.user_consents', 'DELETE'),
  'authenticated NIE ma grantu DELETE do user_consents (usuniecie dowodu niemozliwe)'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.user_consents', 'SELECT'),
  'authenticated ZACHOWUJE grant SELECT do user_consents (wlasciciel widzi swoj stan)'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.user_consent_events', 'INSERT'),
  'anon NIE ma grantu INSERT do user_consent_events'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.user_consent_events', 'INSERT'),
  'authenticated NIE ma grantu INSERT do user_consent_events (fabrykacja zdarzenia niemozliwa)'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.user_consent_events', 'UPDATE'),
  'authenticated NIE ma grantu UPDATE do user_consent_events (dziennik jest append-only)'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.user_consent_events', 'DELETE'),
  'authenticated NIE ma grantu DELETE do user_consent_events (dziennik jest append-only)'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.user_consent_events', 'SELECT'),
  'authenticated ZACHOWUJE grant SELECT do user_consent_events (wlasciciel widzi swoja historie)'
);
SELECT ok(
  has_table_privilege('service_role', 'public.user_consents', 'INSERT'),
  'service_role ZACHOWUJE zapis do user_consents (scieżka serwerowa / eksport RODO)'
);
SELECT ok(
  has_table_privilege('service_role', 'public.user_consent_events', 'INSERT'),
  'service_role ZACHOWUJE zapis do user_consent_events'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_get_user_consent(uuid)', 'EXECUTE'),
  'anon NIE ma EXECUTE na admin_get_user_consent'
);

-- ── 2. Polityki: obie tabele maja wylacznie sciezke SELECT ──────────────────
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_consents' AND cmd <> 'SELECT'),
  0,
  'user_consents: zero polityk zapisu (own-row INSERT/UPDATE/DELETE usuniete)'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_consent_events' AND cmd <> 'SELECT'),
  0,
  'user_consent_events: zero polityk zapisu (own-row INSERT usuniety)'
);

-- ── 3. Zachowanie: sesja czlonka najemcy A nie tknie rejestru ───────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"ce0a0000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO public.user_consents (user_id, consent_key, given, version)
    VALUES ('ce0a0000-0000-0000-0000-0000000000a2', 'marketing', true, 'forged')$$,
  '42501',
  NULL,
  'user_consents: INSERT klienta odrzucony (nie da sie dopisac zgody, ktorej nie wyrazil)'
);
SELECT throws_ok(
  $$UPDATE public.user_consents SET given = true
     WHERE user_id = 'ce0a0000-0000-0000-0000-0000000000a2'$$,
  '42501',
  NULL,
  'user_consents: UPDATE klienta odrzucony (stan nie rozjedzie sie z dziennikiem)'
);
SELECT throws_ok(
  $$DELETE FROM public.user_consents
     WHERE user_id = 'ce0a0000-0000-0000-0000-0000000000a2'$$,
  '42501',
  NULL,
  'user_consents: DELETE klienta odrzucony (dowod zgody nieusuwalny)'
);
SELECT throws_ok(
  $$INSERT INTO public.user_consent_events (user_id, consent_key, given, version)
    VALUES ('ce0a0000-0000-0000-0000-0000000000a2', 'marketing', true, 'forged')$$,
  '42501',
  NULL,
  'user_consent_events: INSERT klienta odrzucony (zdarzenie tylko z set_user_consent)'
);
SELECT throws_ok(
  $$UPDATE public.user_consent_events SET given = true
     WHERE user_id = 'ce0a0000-0000-0000-0000-0000000000a2'$$,
  '42501',
  NULL,
  'user_consent_events: UPDATE klienta odrzucony (append-only)'
);
SELECT throws_ok(
  $$DELETE FROM public.user_consent_events
     WHERE user_id = 'ce0a0000-0000-0000-0000-0000000000a2'$$,
  '42501',
  NULL,
  'user_consent_events: DELETE klienta odrzucony (append-only)'
);

-- ── 4. Scieżka legalna: RPC nadal zapisuje i sam stempluje dowod ────────────
SELECT public.set_user_consent(
  p_key => 'analytics',
  p_given => true,
  p_version => '2026-08',
  p_gpc => false,
  p_lang => 'pl',
  p_ip => '203.0.113.7',
  p_user_agent => 'pgTAP',
  p_source => 'account',
  p_banner_version => 'b1',
  p_decision_id => 'ce0d0000-0000-0000-0000-0000000000d1',
  p_page_url => '/profile/privacy'
);

SELECT is(
  (SELECT count(*)::int FROM public.user_consents
    WHERE user_id = 'ce0a0000-0000-0000-0000-0000000000a2'),
  1,
  'set_user_consent zapisal stan zgody mimo braku grantu klienta (scieżka zapisu zyje)'
);
SELECT is(
  (SELECT tenant_id FROM public.user_consents
    WHERE user_id = 'ce0a0000-0000-0000-0000-0000000000a2' AND consent_key = 'analytics'),
  'ce111111-1111-1111-1111-111111111111'::uuid,
  'tenant_id dowodu ustala funkcja z profilu wolajacego, nie klient'
);
SELECT ok(
  (SELECT given_at IS NOT NULL AND given_at <= now() FROM public.user_consents
    WHERE user_id = 'ce0a0000-0000-0000-0000-0000000000a2' AND consent_key = 'analytics'),
  'given_at stempluje baza (klient nie podaje znacznika czasu)'
);
SELECT is(
  (SELECT count(*)::int FROM public.user_consent_events
    WHERE user_id = 'ce0a0000-0000-0000-0000-0000000000a2' AND consent_key = 'analytics'),
  1,
  'ta sama decyzja dopisala dokladnie jeden wpis do dziennika append-only'
);

-- ── 5. K4: lustro CMP nie przekracza granicy najemcy ────────────────────────
SELECT ok(
  public.admin_get_user_consent('ce0a0000-0000-0000-0000-0000000000a2') IS NULL,
  'bramka roli trzyma: czlonek bez roli admina nie czyta lustra CMP (nawet swojego)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"ce0a0000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  public.admin_get_user_consent('ce0a0000-0000-0000-0000-0000000000a2'),
  '{"categories":{"necessary":true,"analytics":false},"version":"2026-01"}'::jsonb,
  'admin najemcy A czyta lustro CMP uzytkownika WLASNEGO najemcy'
);
SELECT ok(
  public.admin_get_user_consent('ce0b0000-0000-0000-0000-0000000000b1') IS NULL,
  'admin najemcy A NIE czyta zgod uzytkownika najemcy B'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
