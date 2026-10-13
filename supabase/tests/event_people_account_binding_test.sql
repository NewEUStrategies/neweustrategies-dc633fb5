-- pgTAP: konto wiaze sie z kartoteka uczestnika wydarzen WYLACZNIE przez
-- potwierdzony adres, a dowiazania sprzed poprawki da sie wykryc, odwiazac
-- i - jawnie, z dziennikiem - przywrocic (REG-01, decyzja D14; migracje
-- 20261012120000, 20261012120100, 20261012190000).
--
-- DEFEKT
--   * `event_my_event_profile_set` (20260828140004:127) przestawial adres
--     kartoteki na dowolny adres o poprawnym ksztalcie - konto zawlaszczalo
--     cudzy, jeszcze nieuzyty adres, a kolejne zapisy i bilety jego
--     wlasciciela trafialy do kartoteki napastnika;
--   * `event_my_event_profile_sync_account` (20260828105751:494) kopiowal
--     `profiles.contact_email`/`email` - kolumny, ktore zalogowany zmienia sam;
--   * dowiazania zrobione przed seria 20261012 (zapis po adresie z ladunku)
--     nie mialy ani audytu, ani drogi naprawy.
--
-- KRYTERIA AKCEPTACJI (nazwy asercji): „konto X zapisuje adres Y -> user_id
-- osoby Y zostaje NULL" przypina B1a (event_registration_identity_integrity_test);
-- tu - zamkniecie zawlaszczenia przez profil i synchronizacje, naprawa
-- historii (audyt widzi symulowane przejecie jako foreign_record, odwiazanie
-- zwraca liczbe, „audyt zwraca 0 wierszy"), przywrocenie przez
-- administratora z atestem, odmowa obcego najemcy i samodzielne dowiazanie
-- tylko potwierdzonego adresu.
BEGIN;
SELECT plan(44);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b2ab0000-0000-0000-0000-0000000000aa', 'eab-a', 'Account Binding A', 'eab-a.example'),
  ('b2ab0000-0000-0000-0000-0000000000bb', 'eab-b', 'Account Binding B', 'eab-b.example');

-- U i M: adres NIEPOTWIERDZONY. K2, Q, Q2: konto potwierdzilo NOWY adres
-- (bezpieczna zmiana adresu w GoTrue), kartoteka ma jeszcze stary.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b2a00000-0000-0000-0000-0000000000a1', 'x@eab.example', now()),
  ('b2a00000-0000-0000-0000-0000000000a2', 'y@eab.example', now()),
  ('b2a00000-0000-0000-0000-0000000000a3', 'u@eab.example', NULL),
  ('b2a00000-0000-0000-0000-0000000000a4', 'x2@eab.example', now()),
  ('b2a00000-0000-0000-0000-0000000000a5', 'x3@eab.example', now()),
  ('b2a00000-0000-0000-0000-0000000000a6', 'x4@eab.example', now()),
  ('b2a00000-0000-0000-0000-0000000000a7', 'K@eab.example', now()),
  ('b2a00000-0000-0000-0000-0000000000a8', 'm@eab.example', NULL),
  ('b2a00000-0000-0000-0000-0000000000a9', 'k2-new@eab.example', now()),
  ('b2a00000-0000-0000-0000-0000000000aa', 'q-new@eab.example', now()),
  ('b2a00000-0000-0000-0000-0000000000ab', 'q2-new@eab.example', now()),
  ('b2a00000-0000-0000-0000-0000000000ac', 'n@eab.example', now()),
  ('b2a00000-0000-0000-0000-0000000000b1', 'admin-a@eab.example', now()),
  ('b2a00000-0000-0000-0000-0000000000b2', 'admin-b@eab.example', now()),
  ('b2a00000-0000-0000-0000-0000000000b3', 'xb@eab.example', now());
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('b2a00000-0000-0000-0000-0000000000a1', 'x@eab.example', 'EAB X', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000a2', 'y@eab.example', 'EAB Y', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000a3', 'u@eab.example', 'EAB U', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000a4', 'x2@eab.example', 'EAB X2', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000a5', 'x3@eab.example', 'EAB X3', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000a6', 'x4@eab.example', 'EAB X4', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000a7', 'k@eab.example', 'EAB K', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000a8', 'm@eab.example', 'EAB M', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000a9', 'k2-new@eab.example', 'EAB K2', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000aa', 'q-new@eab.example', 'EAB Q', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000ab', 'q2-new@eab.example', 'EAB Q2', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000ac', 'n@eab.example', 'EAB N', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000b1', 'admin-a@eab.example', 'EAB Admin A', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000b2', 'admin-b@eab.example', 'EAB Admin B', 'b2ab0000-0000-0000-0000-0000000000bb'),
  ('b2a00000-0000-0000-0000-0000000000b3', 'xb@eab.example', 'EAB XB', 'b2ab0000-0000-0000-0000-0000000000bb');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('b2a00000-0000-0000-0000-0000000000b1', 'admin', 'b2ab0000-0000-0000-0000-0000000000aa'),
  ('b2a00000-0000-0000-0000-0000000000b2', 'admin', 'b2ab0000-0000-0000-0000-0000000000bb');

-- Q2 ma w profilu konta adres, ktorego nie potwierdzil (kolumny zmieniane
-- przez samego zalogowanego) - synchronizacja nie moze go przeniesc.
UPDATE public.profiles SET contact_email = 'spoof@eab.example'
 WHERE id IN ('b2a00000-0000-0000-0000-0000000000a2', 'b2a00000-0000-0000-0000-0000000000ab');

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, created_by) VALUES
  -- Dowiazania zgodne z D1.
  ('b2c00000-0000-0000-0000-0000000000c1', 'b2ab0000-0000-0000-0000-0000000000aa',
   'b2a00000-0000-0000-0000-0000000000a1', 'x@eab.example', 'Xawery', 'Iks', 'b2a00000-0000-0000-0000-0000000000a1'),
  ('b2c00000-0000-0000-0000-0000000000c2', 'b2ab0000-0000-0000-0000-0000000000aa',
   'b2a00000-0000-0000-0000-0000000000a2', 'y@eab.example', 'Yvonne', 'Yellow', 'b2a00000-0000-0000-0000-0000000000a2'),
  -- Goscie bez konta (samodzielne dowiazanie).
  ('b2c00000-0000-0000-0000-0000000000c4', 'b2ab0000-0000-0000-0000-0000000000aa',
   NULL, 'k@eab.example', 'Kamil', 'Gosc', NULL),
  ('b2c00000-0000-0000-0000-0000000000c5', 'b2ab0000-0000-0000-0000-0000000000aa',
   NULL, 'm@eab.example', 'Marta', 'Gosc', NULL),
  -- K2: konto potwierdzilo nowy adres; stary adres zostal w kartotece,
  -- a nowy ma osobna kartoteka goscia.
  ('b2c00000-0000-0000-0000-0000000000c6', 'b2ab0000-0000-0000-0000-0000000000aa',
   'b2a00000-0000-0000-0000-0000000000a9', 'k2@eab.example', 'Karol', 'Stary', 'b2a00000-0000-0000-0000-0000000000a9'),
  ('b2c00000-0000-0000-0000-0000000000c7', 'b2ab0000-0000-0000-0000-0000000000aa',
   NULL, 'k2-new@eab.example', 'Karol', 'Nowy', NULL),
  -- Q, Q2: konto potwierdzilo nowy adres, kartoteka ma stary.
  ('b2c00000-0000-0000-0000-0000000000c8', 'b2ab0000-0000-0000-0000-0000000000aa',
   'b2a00000-0000-0000-0000-0000000000aa', 'q-old@eab.example', 'Quentin', 'Stary', 'b2a00000-0000-0000-0000-0000000000aa'),
  ('b2c00000-0000-0000-0000-0000000000c9', 'b2ab0000-0000-0000-0000-0000000000aa',
   'b2a00000-0000-0000-0000-0000000000ab', 'q2-old@eab.example', 'Quinn', 'Stary', 'b2a00000-0000-0000-0000-0000000000ab'),
  -- L: gosc (created_by NULL) - dowiazanie do X2 dojdzie nizej (symulacja
  -- przejecia sprzed poprawki).
  ('b2c00000-0000-0000-0000-0000000000ca', 'b2ab0000-0000-0000-0000-0000000000aa',
   NULL, 'l@eab.example', 'Lena', 'Ofiara', NULL),
  -- S: konto U samo zalozylo osobe na swoj NIEPOTWIERDZONY adres.
  ('b2c00000-0000-0000-0000-0000000000cb', 'b2ab0000-0000-0000-0000-0000000000aa',
   'b2a00000-0000-0000-0000-0000000000a3', 'u@eab.example', 'Urszula', 'Niepotw', 'b2a00000-0000-0000-0000-0000000000a3'),
  -- W: X3 zapisal sie adresem sluzbowym, innym niz adres konta.
  ('b2c00000-0000-0000-0000-0000000000cc', 'b2ab0000-0000-0000-0000-0000000000aa',
   'b2a00000-0000-0000-0000-0000000000a5', 'w-work@eab.example', 'Wojciech', 'Sluzbowy', 'b2a00000-0000-0000-0000-0000000000a5'),
  -- E: dowiazana osoba bez adresu.
  ('b2c00000-0000-0000-0000-0000000000cd', 'b2ab0000-0000-0000-0000-0000000000aa',
   'b2a00000-0000-0000-0000-0000000000a6', NULL, 'Ewa', 'Bezadresu', 'b2a00000-0000-0000-0000-0000000000a6'),
  -- Gosc o adresie konta X3 (dowiaze sie sam po naprawie).
  ('b2c00000-0000-0000-0000-0000000000ce', 'b2ab0000-0000-0000-0000-0000000000aa',
   NULL, 'x3@eab.example', 'Wojciech', 'Gosc', NULL),
  -- Najemca B: przejecie u innego najemcy.
  ('b2c00000-0000-0000-0000-0000000000cf', 'b2ab0000-0000-0000-0000-0000000000bb',
   NULL, 'lb@eab.example', 'Lucja', 'Ofiara', NULL);
-- Symulacja przejecia sprzed poprawki: stary zapis wiazal konto wolajacego
-- z osoba o adresie z ladunku (20261007140400:535).
UPDATE public.event_people SET user_id = 'b2a00000-0000-0000-0000-0000000000a4'
 WHERE id = 'b2c00000-0000-0000-0000-0000000000ca';
UPDATE public.event_people SET user_id = 'b2a00000-0000-0000-0000-0000000000b3'
 WHERE id = 'b2c00000-0000-0000-0000-0000000000cf';

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('b2e00000-0000-0000-0000-0000000000e1', 'b2ab0000-0000-0000-0000-0000000000aa',
   'eab-e1', 'EAB 1', 'EAB 1', now() + interval '30 days', 'published');
-- Zgloszenie zalozone przez konto X2 na kartoteke L (slad napastnika).
INSERT INTO public.event_registrations (tenant_id, event_id, person_id, status, registration_mode, created_by) VALUES
  ('b2ab0000-0000-0000-0000-0000000000aa', 'b2e00000-0000-0000-0000-0000000000e1',
   'b2c00000-0000-0000-0000-0000000000ca', 'approved', 'rsvp', 'b2a00000-0000-0000-0000-0000000000a4');

CREATE TEMP TABLE eab_r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON eab_r TO service_role, authenticated, anon;

-- ── 1-6. ACL ─────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_person_account_risk(uuid,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_person_account_risk(uuid,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_email_hint(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_email_hint(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_people_unbind_unverified(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_people_unbind_unverified(text)', 'EXECUTE'),
  'pomocnicze dowiazan (ryzyko, maska adresu, naprawa historii): brak EXECUTE dla anon i authenticated');
SELECT ok(
  NOT has_function_privilege('anon', 'public.event_people_account_binding_audit(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_people_account_binding_audit(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_people_account_binding_audit(uuid)', 'EXECUTE'),
  'audyt dowiazan: tylko service_role');
SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_event_people_account_bindings(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_person_account_unbind(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_person_account_restore(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_people_account_bindings(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_person_account_unbind(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_person_account_restore(jsonb)', 'EXECUTE'),
  'RPC organizatora: authenticated (bramka administratora w srodku), nigdy anon');
SELECT ok(
  NOT has_function_privilege('anon', 'public.event_my_account_link(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_my_account_link(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_my_event_profile_set(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_my_event_profile_sync_account(jsonb)', 'EXECUTE'),
  'samoobsluga uczestnika (dowiazanie, profil, synchronizacja): authenticated, nie anon');
SELECT ok(
  NOT has_table_privilege('anon', 'public.event_person_account_unbinds', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.event_person_account_unbinds', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.event_person_account_unbinds', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.event_person_account_unbinds', 'UPDATE'),
  'dziennik odwiazan: zadnego dostepu dla anon i authenticated');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_person_account_unbinds'::regclass)
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'event_person_account_unbinds'),
  'dziennik odwiazan: RLS wlaczone bez polityk (deny-all)');

-- ── 7-14. Profil wydarzenia: adres tylko potwierdzony ────────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"eab-a.example"}', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$SELECT public.event_my_event_profile_set('{"slug":"eab-e1","email":"evil@eab.example"}'::jsonb)$$,
  'email_unverified%',
  'Y przestawia adres profilu na cudzy -> email_unverified');
SELECT lives_ok(
  $$SELECT public.event_my_event_profile_set('{"slug":"eab-e1","email":"Y@EAB.example ","first_name":"Yvette"}'::jsonb)$$,
  'Y: ten sam adres inna wielkoscia liter i ze spacja to nie zmiana adresu');
SELECT throws_like(
  $$SELECT public.event_my_event_profile_set('{"slug":"eab-e1","email":""}'::jsonb)$$,
  'email_required%',
  'Y: pusty adres zamiast obecnego -> email_required');
RESET ROLE;
SELECT is(
  (SELECT email_norm || '|' || first_name FROM public.event_people WHERE id = 'b2c00000-0000-0000-0000-0000000000c2'),
  'y@eab.example|Yvette',
  'Y: adres kartoteki bez zmian po odmowach, reszta profilu zapisana');

-- X (dowiazany do x@) celuje w nieuzyty jeszcze adres ofiary.
SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$SELECT public.event_my_event_profile_set('{"slug":"eab-e1","email":"y2@eab.example"}'::jsonb)$$,
  'email_unverified%',
  'zawlaszczenie przez profil zamkniete: X nie przestawi swojej kartoteki na nieuzyty adres y2@');
-- K2: potwierdzony adres konta ma juz inna osoba najemcy.
SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000a9","role":"authenticated"}', true);
SELECT throws_like(
  $$SELECT public.event_my_event_profile_set('{"slug":"eab-e1","email":"k2-new@eab.example"}'::jsonb)$$,
  'email_in_use%',
  'K2: potwierdzony adres konta nalezy do innej osoby najemcy -> email_in_use');
-- Q: prawowita zmiana na potwierdzony adres konta przechodzi.
SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.event_my_event_profile_set('{"slug":"eab-e1","email":"Q-New@eab.example"}'::jsonb)$$,
  'Q: zmiana adresu profilu na POTWIERDZONY adres konta przechodzi');
RESET ROLE;
SELECT is(
  (SELECT email_norm FROM public.event_people WHERE id = 'b2c00000-0000-0000-0000-0000000000c8'),
  'q-new@eab.example',
  'Q: kartoteka ma potwierdzony adres konta (dowiazanie spelnia teraz D1)');

-- ── 15-16. Synchronizacja z kontem: adres tylko z auth, potwierdzony ─────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.event_my_event_profile_sync_account('{"slug":"eab-e1"}'::jsonb)$$,
  'Y: synchronizacja z kontem przechodzi');
SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000ab","role":"authenticated"}', true);
SELECT lives_ok($$SELECT public.event_my_event_profile_sync_account('{"slug":"eab-e1"}'::jsonb)$$,
  'Q2: synchronizacja z kontem przechodzi');
RESET ROLE;
SELECT is(
  (SELECT email_norm FROM public.event_people WHERE id = 'b2c00000-0000-0000-0000-0000000000c2'),
  'y@eab.example',
  'synchronizacja nie kopiuje profiles.contact_email (spoof@) do kartoteki Y');
SELECT is(
  (SELECT email_norm FROM public.event_people WHERE id = 'b2c00000-0000-0000-0000-0000000000c9'),
  'q2-new@eab.example',
  'synchronizacja Q2 bierze POTWIERDZONY adres logowania (auth.users), nie adres z profilu');

-- ── 17-19. Samodzielne dowiazanie: tylko potwierdzony adres ──────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000a7","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO eab_r VALUES ('link_k', public.event_my_account_link('{}'::jsonb));
SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000a8","role":"authenticated"}', true);
INSERT INTO eab_r VALUES ('link_m', public.event_my_account_link('{}'::jsonb));
SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000ac","role":"authenticated"}', true);
INSERT INTO eab_r VALUES ('link_n', public.event_my_account_link('{}'::jsonb));
RESET ROLE;
SELECT ok(
  (SELECT (v->>'linked')::boolean FROM eab_r WHERE k = 'link_k')
  AND (SELECT user_id FROM public.event_people WHERE id = 'b2c00000-0000-0000-0000-0000000000c4')
      = 'b2a00000-0000-0000-0000-0000000000a7',
  'event_my_account_link: konto K z potwierdzonym adresem (inna wielkosc liter) dowiazuje kartoteke goscia k@');
SELECT ok(
  (SELECT v->>'linked' = 'false' AND v->>'reason' = 'email_unconfirmed' FROM eab_r WHERE k = 'link_m')
  AND (SELECT user_id IS NULL FROM public.event_people WHERE id = 'b2c00000-0000-0000-0000-0000000000c5'),
  'event_my_account_link: konto M bez potwierdzenia nie dowiazuje kartoteki m@');
SELECT is((SELECT v->>'reason' FROM eab_r WHERE k = 'link_n'), 'no_record',
  'event_my_account_link: brak kartoteki o adresie konta -> no_record');

-- ── 20-27. Naprawa historii ─────────────────────────────────────────────────
SELECT set_eq(
  $$SELECT person_id, risk FROM public.event_people_account_binding_audit('b2ab0000-0000-0000-0000-0000000000aa')$$,
  $$VALUES ('b2c00000-0000-0000-0000-0000000000ca'::uuid, 'foreign_record'::text),
           ('b2c00000-0000-0000-0000-0000000000cb'::uuid, 'account_unconfirmed'::text),
           ('b2c00000-0000-0000-0000-0000000000cc'::uuid, 'self_created'::text),
           ('b2c00000-0000-0000-0000-0000000000cd'::uuid, 'no_email'::text),
           ('b2c00000-0000-0000-0000-0000000000c6'::uuid, 'self_created'::text)$$,
  'audyt najemcy A: symulowane przejecie L jako foreign_record + kazda inna klasa ryzyka; dowiazania D1 poza audytem');
SELECT is(
  (SELECT registrations_by_account::integer || '|' || account_email_norm || '|' || account_email_confirmed::text
     FROM public.event_people_account_binding_audit('b2ab0000-0000-0000-0000-0000000000aa')
    WHERE person_id = 'b2c00000-0000-0000-0000-0000000000ca'),
  '1|x2@eab.example|true',
  'audyt: przejecie L niesie slady napastnika (1 zgloszenie zalozone przez konto X2) i adres konta');
SELECT set_eq(
  $$SELECT person_id, risk FROM public.event_people_account_binding_audit('b2ab0000-0000-0000-0000-0000000000bb')$$,
  $$VALUES ('b2c00000-0000-0000-0000-0000000000cf'::uuid, 'foreign_record'::text)$$,
  'audyt najemcy B: tylko jego wiersze (filtr najemcy)');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(public._event_people_unbind_unverified('reg01_remediation'), 6,
  'naprawa historii odwiazuje kazde dowiazanie z audytu (5 u najemcy A, 1 u B) i zwraca liczbe');
RESET ROLE;
-- Identyfikatory wpisow dziennika dla wywolan jako authenticated (rola klienta
-- nie czyta dziennika).
INSERT INTO eab_r
SELECT 'ub_' || b.person_id::text, to_jsonb(b.id)
  FROM public.event_person_account_unbinds b
 WHERE b.tenant_id = 'b2ab0000-0000-0000-0000-0000000000aa';
SELECT ok(
  (SELECT user_id IS NULL FROM public.event_people WHERE id = 'b2c00000-0000-0000-0000-0000000000ca')
  AND EXISTS (
    SELECT 1 FROM public.event_person_account_unbinds b
     WHERE b.tenant_id = 'b2ab0000-0000-0000-0000-0000000000aa'
       AND b.person_id = 'b2c00000-0000-0000-0000-0000000000ca'
       AND b.user_id = 'b2a00000-0000-0000-0000-0000000000a4'
       AND b.reason = 'reg01_remediation' AND b.risk = 'foreign_record'
       AND b.registrations_by_account = 1 AND b.email_norm = 'l@eab.example'
       AND b.restored_at IS NULL),
  'L odwiazana, dziennik ma wpis naprawy (konto, ryzyko, adres, slady)');
SELECT ok(
  (SELECT user_id FROM public.event_people WHERE id = 'b2c00000-0000-0000-0000-0000000000c2')
    = 'b2a00000-0000-0000-0000-0000000000a2'
  AND (SELECT user_id FROM public.event_people WHERE id = 'b2c00000-0000-0000-0000-0000000000c8')
    = 'b2a00000-0000-0000-0000-0000000000aa',
  'naprawa nie rusza dowiazan spelniajacych D1');
SELECT is_empty(
  $$SELECT * FROM public.event_people_account_binding_audit('b2ab0000-0000-0000-0000-0000000000aa')$$,
  'audyt zwraca 0 wierszy');
SELECT is_empty(
  $$SELECT * FROM public.event_people_account_binding_audit()$$,
  'audyt wszystkich najemcow po naprawie: 0 wierszy (kontrola po wdrozeniu)');

-- ── 28-30. Po naprawie: wlasciciel adresu wraca sam ──────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO eab_r VALUES ('link_x3', public.event_my_account_link('{}'::jsonb));
SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
INSERT INTO eab_r VALUES ('link_x2', public.event_my_account_link('{}'::jsonb));
RESET ROLE;
SELECT ok(
  (SELECT (v->>'linked')::boolean FROM eab_r WHERE k = 'link_x3')
  AND (SELECT user_id FROM public.event_people WHERE id = 'b2c00000-0000-0000-0000-0000000000ce')
      = 'b2a00000-0000-0000-0000-0000000000a5',
  'odwiazany X3 dowiazuje sie sam do kartoteki o POTWIERDZONYM adresie konta');
SELECT ok(
  (SELECT v->>'linked' = 'false' AND v->>'reason' = 'no_record' FROM eab_r WHERE k = 'link_x2')
  AND (SELECT user_id IS NULL FROM public.event_people WHERE id = 'b2c00000-0000-0000-0000-0000000000ca'),
  'napastnik X2 nie odzyskuje kartoteki L samodzielnym dowiazaniem (adres l@ nie jest jego)');
SELECT is_empty(
  $$SELECT * FROM public.event_people_account_binding_audit('b2ab0000-0000-0000-0000-0000000000aa')$$,
  'samodzielne dowiazania po naprawie nie wracaja do audytu');

-- ── 31-43. Ekran organizatora ─────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO eab_r VALUES ('list_a', public.admin_event_people_account_bindings('{}'::jsonb));
RESET ROLE;
SELECT ok(
  (SELECT jsonb_array_length(v->'unverified') = 0 FROM eab_r WHERE k = 'list_a')
  AND (SELECT count(*) = 5 FROM eab_r, jsonb_array_elements(v->'unbinds') u WHERE k = 'list_a')
  AND EXISTS (SELECT 1 FROM eab_r, jsonb_array_elements(v->'unbinds') u
               WHERE k = 'list_a' AND u->>'person_id' = 'b2c00000-0000-0000-0000-0000000000ca'
                 AND u->>'risk' = 'foreign_record' AND u->>'account_email_hint' = 'x***@eab.example'
                 AND u->>'last_name' = 'Ofiara'),
  'lista organizatora A: dziennik 5 odwiazan najemcy A, adres konta zamaskowany, bez niezweryfikowanych');

SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_like(
  format($$SELECT public.admin_event_person_account_restore(jsonb_build_object('unbind_id', %L))$$,
         (SELECT v #>> '{}' FROM eab_r WHERE k = 'ub_b2c00000-0000-0000-0000-0000000000ca')),
  'not_found%',
  'administrator najemcy B nie przywraca dowiazania najemcy A (najemca z sesji)');
SELECT throws_like(
  $$SELECT public.admin_event_person_account_unbind('{"person_id":"b2c00000-0000-0000-0000-0000000000c2"}'::jsonb)$$,
  'not_found%',
  'administrator najemcy B nie odwiazuje osoby najemcy A');
SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT throws_like(
  $$SELECT public.admin_event_people_account_bindings('{}'::jsonb)$$,
  'forbidden%',
  'zwykly uczestnik nie widzi ekranu dowiazan (forbidden)');

SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
INSERT INTO eab_r
SELECT 'restore_l', public.admin_event_person_account_restore(jsonb_build_object('unbind_id', r.v #>> '{}'))
  FROM eab_r r
 WHERE r.k = 'ub_b2c00000-0000-0000-0000-0000000000ca';
RESET ROLE;
SELECT ok(
  (SELECT (v->>'ok')::boolean FROM eab_r WHERE k = 'restore_l')
  AND (SELECT user_id FROM public.event_people WHERE id = 'b2c00000-0000-0000-0000-0000000000ca')
      = 'b2a00000-0000-0000-0000-0000000000a4'
  AND EXISTS (SELECT 1 FROM public.event_person_account_unbinds b
               WHERE b.person_id = 'b2c00000-0000-0000-0000-0000000000ca'
                 AND b.restored_at IS NOT NULL
                 AND b.restored_by = 'b2a00000-0000-0000-0000-0000000000b1'
                 AND b.restored_email_norm = 'l@eab.example'),
  'administrator A przywraca dowiazanie L (jawny, logowany wyjatek od D1)');
SELECT is_empty(
  $$SELECT * FROM public.event_people_account_binding_audit('b2ab0000-0000-0000-0000-0000000000aa')$$,
  'przywrocenie jest atestem administratora - audyt najemcy zostaje pusty');
UPDATE public.event_people SET email = 'l2@eab.example' WHERE id = 'b2c00000-0000-0000-0000-0000000000ca';
SELECT set_eq(
  $$SELECT person_id, risk FROM public.event_people_account_binding_audit('b2ab0000-0000-0000-0000-0000000000aa')$$,
  $$VALUES ('b2c00000-0000-0000-0000-0000000000ca'::uuid, 'foreign_record'::text)$$,
  'atest dotyczy adresu z chwili przywrocenia - zmiana adresu osoby wraca do audytu');
UPDATE public.event_people SET email = 'l@eab.example' WHERE id = 'b2c00000-0000-0000-0000-0000000000ca';

SELECT set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_like(
  format($$SELECT public.admin_event_person_account_restore(jsonb_build_object('unbind_id', %L))$$,
         (SELECT v #>> '{}' FROM eab_r WHERE k = 'ub_b2c00000-0000-0000-0000-0000000000ca')),
  'already_restored%',
  'drugie przywrocenie tego samego wpisu -> already_restored');
-- W (X3) - konto dowiazalo sie juz samo do innej kartoteki.
SELECT throws_like(
  format($$SELECT public.admin_event_person_account_restore(jsonb_build_object('unbind_id', %L))$$,
         (SELECT v #>> '{}' FROM eab_r WHERE k = 'ub_b2c00000-0000-0000-0000-0000000000cc')),
  'account_in_use%',
  'przywrocenie konta dowiazanego juz do innej osoby -> account_in_use');
SELECT throws_like(
  $$SELECT public.admin_event_person_account_unbind('{"person_id":"b2c00000-0000-0000-0000-0000000000c5"}'::jsonb)$$,
  'not_bound%',
  'odwiazanie osoby bez konta -> not_bound');
INSERT INTO eab_r VALUES ('unbind_k',
  public.admin_event_person_account_unbind('{"person_id":"b2c00000-0000-0000-0000-0000000000c4"}'::jsonb));
RESET ROLE;
SELECT ok(
  (SELECT user_id IS NULL FROM public.event_people WHERE id = 'b2c00000-0000-0000-0000-0000000000c4')
  AND EXISTS (SELECT 1 FROM public.event_person_account_unbinds b
               WHERE b.id = (SELECT (v->>'unbind_id')::uuid FROM eab_r WHERE k = 'unbind_k')
                 AND b.reason = 'admin_unbind' AND b.risk = 'verified'
                 AND b.unbound_by = 'b2a00000-0000-0000-0000-0000000000b1'
                 AND b.user_id = 'b2a00000-0000-0000-0000-0000000000a7'),
  'administrator odwiazuje konto K: wpis admin_unbind z ryzykiem verified i autorem');
SELECT throws_like(
  $$INSERT INTO public.event_person_account_unbinds (tenant_id, person_id, user_id, risk, reason)
    VALUES ('b2ab0000-0000-0000-0000-0000000000aa', 'b2c00000-0000-0000-0000-0000000000c2',
            'b2a00000-0000-0000-0000-0000000000a2', 'verified', 'reg01_remediation')$$,
  '%event_person_account_unbinds_remediation_unverified%',
  'CHECK: naprawa historii nie moze odwiazac dowiazania spelniajacego D1');

SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '', true);
SELECT * FROM finish();
ROLLBACK;
