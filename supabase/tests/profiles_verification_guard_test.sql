-- pgTAP: KTO moze zmienic weryfikacje profilu (i kto na pewno nie).
--
-- Dlaczego ten plik jest zachowaniowy, a nie strukturalny. Weryfikacja profilu nie
-- jest ozdoba: `sync_org_verification` przeklada ja na odznake, a odznaka `expert`
-- nadaje dozywotni VIP (`sync_expert_vip_grant`). Migracja 20260806094104 zawezila
-- guard do samej roli `admin` - `super_admin` bez osobnej roli `admin` przestal
-- moc nadawac weryfikacje, a poprzednia wersja tego pliku sprawdzala tylko, czy
-- funkcja i trigger ISTNIEJA, wiec zawezenie przeszlo przez pgTAP bez sygnalu.
-- Migracja 20260806150000 przywraca `super_admin`, sprowadza decyzje do jednego
-- predykatu `can_manage_profile_verification()` i rozdziela wlasnosc kolumn:
--   - verified_at / verified_by -> profiles_guard_verification (twarde 42501),
--   - current_company_id        -> profiles_guard_privileged_columns (cichy revert
--     dla cudzego wiersza, ale WLASCICIEL ma prawo do swojej firmy - to sciezka UI
--     `link_current_company`, ktora wczesniej cofala sie po cichu).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(16);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('b1111111-1111-1111-1111-111111111111', 'tenant-vg-a', 'Tenant VG A'),
  ('b2222222-2222-2222-2222-222222222222', 'tenant-vg-b', 'Tenant VG B');

INSERT INTO auth.users (id, email) VALUES
  ('b1000000-0000-0000-0000-0000000000a1', 'admin-vg@vg.test'),
  ('b1000000-0000-0000-0000-0000000000a2', 'superadmin-vg@vg.test'),
  ('b1000000-0000-0000-0000-0000000000a3', 'editor-vg@vg.test'),
  ('b1000000-0000-0000-0000-0000000000a4', 'member-vg@vg.test'),
  ('b2000000-0000-0000-0000-0000000000b1', 'admin-vg-b@vg.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable) VALUES
  ('b1000000-0000-0000-0000-0000000000a1', 'admin-vg@vg.test', 'Admin VG',
   'b1111111-1111-1111-1111-111111111111', true),
  ('b1000000-0000-0000-0000-0000000000a2', 'superadmin-vg@vg.test', 'Super Admin VG',
   'b1111111-1111-1111-1111-111111111111', true),
  ('b1000000-0000-0000-0000-0000000000a3', 'editor-vg@vg.test', 'Editor VG',
   'b1111111-1111-1111-1111-111111111111', true),
  ('b1000000-0000-0000-0000-0000000000a4', 'member-vg@vg.test', 'Member VG',
   'b1111111-1111-1111-1111-111111111111', true),
  ('b2000000-0000-0000-0000-0000000000b1', 'admin-vg-b@vg.test', 'Admin VG B',
   'b2222222-2222-2222-2222-222222222222', true);

-- KRUCJALNE dla tego testu: super_admin NIE ma osobno roli `admin`. Dokladnie ten
-- przypadek wypadl z guardu w 20260806094104.
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('b1000000-0000-0000-0000-0000000000a1', 'admin',
   'b1111111-1111-1111-1111-111111111111'),
  ('b1000000-0000-0000-0000-0000000000a2', 'super_admin',
   'b1111111-1111-1111-1111-111111111111'),
  ('b1000000-0000-0000-0000-0000000000a3', 'editor',
   'b1111111-1111-1111-1111-111111111111'),
  ('b2000000-0000-0000-0000-0000000000b1', 'admin',
   'b2222222-2222-2222-2222-222222222222');

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('b1c00000-0000-0000-0000-0000000000c1', 'b1111111-1111-1111-1111-111111111111',
   'Firma z tenanta A'),
  ('b2c00000-0000-0000-0000-0000000000c2', 'b2222222-2222-2222-2222-222222222222',
   'Firma z tenanta B');

-- -- 1-4. Kontrakt struktury: jeden predykat, jedna bramka na kolumne ---------
SELECT has_function(
  'public', 'can_manage_profile_verification', ARRAY['uuid'],
  'predykat can_manage_profile_verification(uuid) istnieje'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgname = 'profiles_guard_verification_trg'
       AND NOT tgisinternal
  ),
  'trigger profiles_guard_verification_trg jest zalozony na public.profiles'
);

SELECT ok(
  (SELECT prosecdef FROM pg_proc
    WHERE oid = 'public.profiles_guard_verification()'::regprocedure),
  'guard dziala jako SECURITY DEFINER (bramki roli nie omija RLS)'
);

-- Dublowana wlasnosc kolumn byla przyczyna zrodlowa: cichy revert w bramce
-- "privileged" odpalal sie alfabetycznie PRZED "verification" i maskowal odmowe.
SELECT ok(
  pg_get_functiondef('public.profiles_guard_privileged_columns()'::regprocedure)
    NOT LIKE '%verified_at%',
  'profiles_guard_privileged_columns NIE dotyka kolumn weryfikacji (jedna kolumna = jedna bramka)'
);

-- -- 5-8. Predykat: admin i super_admin tak, editor i czlonek nie ------------
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT is(public.can_manage_profile_verification(), true,
  'admin przechodzi predykat weryfikacji');

SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SELECT is(public.can_manage_profile_verification(), true,
  'super_admin BEZ osobnej roli admin przechodzi predykat weryfikacji (regresja 20260806094104)');

SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
SELECT is(public.can_manage_profile_verification(), false,
  'editor NIE nadaje weryfikacji (odznaka eksperta = dozywotni VIP)');

SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
SELECT is(public.can_manage_profile_verification(), false,
  'zwykly czlonek NIE nadaje weryfikacji');

-- -- 9-10. super_admin nadaje weryfikacje przez RPC panelu -------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.admin_set_profile_verification(
       'b1000000-0000-0000-0000-0000000000a4', true) $$,
  'super_admin nadaje weryfikacje profilu w swoim obszarze roboczym'
);

RESET ROLE;
SELECT is(
  (SELECT verified_by FROM public.profiles
    WHERE id = 'b1000000-0000-0000-0000-0000000000a4'),
  'b1000000-0000-0000-0000-0000000000a2'::uuid,
  'verified_by stempluje super_admina, ktory nadal weryfikacje'
);
SET LOCAL ROLE authenticated;

-- -- 11-12. Odmowy: editor przez RPC, czlonek bezposrednim UPDATE ------------
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.admin_set_profile_verification(
       'b1000000-0000-0000-0000-0000000000a4', false) $$,
  '42501', NULL,
  'editor dostaje czysta odmowe 42501 z RPC weryfikacji'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
-- Twarda odmowa zostawia SLAD - do 20260806150000 samonadanie bylo po cichu
-- wycofywane przez bramke kolumn uprzywilejowanych i nie logowalo sie nigdzie.
SELECT throws_ok(
  $$ UPDATE public.profiles SET verified_at = now()
      WHERE id = 'b1000000-0000-0000-0000-0000000000a4' $$,
  '42501', NULL,
  'czlonek nie nadaje sobie weryfikacji (42501, nie cichy revert)'
);

-- -- 13-15. Firma w profilu: wlasciciel ma prawo do SWOJEJ, obca jest cofana -
SELECT lives_ok(
  $$ SELECT public.link_current_company('b1c00000-0000-0000-0000-0000000000c1') $$,
  'czlonek przypisuje sobie firme z wlasnego obszaru roboczego (sciezka UI)'
);

RESET ROLE;
SELECT is(
  (SELECT current_company_id FROM public.profiles
    WHERE id = 'b1000000-0000-0000-0000-0000000000a4'),
  'b1c00000-0000-0000-0000-0000000000c1'::uuid,
  'przypisanie firmy przez wlasciciela FAKTYCZNIE zapisuje sie w bazie'
);
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
-- Firma z obcego tenanta: zapis przechodzi (to nie jest atak wymagajacy wyjatku),
-- ale bramka cofa wartosc - inaczej profil wskazywalby firme z innego tenanta.
UPDATE public.profiles SET current_company_id = 'b2c00000-0000-0000-0000-0000000000c2'
 WHERE id = 'b1000000-0000-0000-0000-0000000000a4';

RESET ROLE;
SELECT is(
  (SELECT current_company_id FROM public.profiles
    WHERE id = 'b1000000-0000-0000-0000-0000000000a4'),
  'b1c00000-0000-0000-0000-0000000000c1'::uuid,
  'firma z OBCEGO tenanta jest po cichu wycofana (zostaje poprzednia)'
);
SET LOCAL ROLE authenticated;

-- -- 16. Izolacja obszarow roboczych w weryfikacji ---------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"b2000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT throws_like(
  $$ SELECT public.admin_set_profile_verification(
       'b1000000-0000-0000-0000-0000000000a4', true) $$,
  '%target outside caller tenant%',
  'admin obcego tenanta nie zweryfikuje profilu z tenanta A'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
