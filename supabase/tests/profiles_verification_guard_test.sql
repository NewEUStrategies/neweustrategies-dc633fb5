-- pgTAP: bramki kolumn `public.profiles` - KTO zmienia `verified_at`/`verified_by`
-- i `current_company_id`, jak wygląda odmowa, które ścieżki są sankcjonowane i
-- gdzie kończy się obszar roboczy.
--
-- PO CO TEN PLIK. Weryfikacja nie jest ozdobą: steruje odznaką `verified`
-- (`sync_org_verification` → `profile_badges`), a odznaka `expert` pociąga
-- DOŻYWOTNI VIP (`sync_expert_vip_grant`). Trzy regresje z jednej doby pokazały,
-- że kontrakt trzeba testować ZACHOWANIEM, nie kształtem:
--   * 20260806094104 po cichu zawęziła krąg uprawnionych do samego `admin`
--     (poprzedni wariant tego pliku sprawdzał wyłącznie istnienie funkcji,
--     triggera i flagi SECURITY DEFINER, więc zawężenie przeszło na zielono),
--   * 20260806150000 rozdzieliła własność kolumn (jedna kolumna = jedna bramka)
--     i sprowadziła decyzję „kto może" do jednego predykatu, ale przepięła oba
--     triggery na `BEFORE UPDATE OF <kolumna>` - gubiąc pokrycie INSERT dodane
--     świadomie w 20260806130000,
--   * 20260806160000 przywraca parytet INSERT/UPDATE i zdejmuje zależność od
--     alfabetycznej kolejności triggerów.
--
-- KONTRAKT KOŃCOWY, który przybija ten plik:
--   1. `verified_at`/`verified_by` należą WYŁĄCZNIE do `profiles_guard_verification`,
--      odmowa jest TWARDA (42501) - także dla zwykłego członka, bo naruszenie ma
--      zostawiać ślad. Cichy revert w bramce bliźniaczej maskował je do 20260806150000.
--   2. Krąg uprawnionych to JEDEN predykat `can_manage_profile_verification()`
--      (`admin`, `super_admin`; `editor` NIE), czytany przez trigger, RPC panelu,
--      RPC domen weryfikacji i politykę RLS `verification_domains`.
--   3. Weryfikację nadaje się tylko w obszarze roboczym WIERSZA - admin tenanta B
--      nie zweryfikuje profilu z tenanta A ani bezpośrednim UPDATE, ani przez RPC.
--   4. Bramka obowiązuje na INSERT: wiersz nie może URODZIĆ SIĘ zweryfikowany ani
--      ze wskazaniem firmy z obcego obszaru roboczego.
--   5. `current_company_id` należy do `profiles_guard_privileged_columns`, reakcja
--      to CICHY revert, a WŁAŚCICIEL wiersza ma prawo do firmy ze swojego tenanta
--      (ścieżka UI `link_current_company` / „odłącz firmę").
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(37);

-- ── Seed ────────────────────────────────────────────────────────────────────
-- Dwa tenanty: A (obszar roboczy testowany) i B (obcy, do izolacji).
-- `ff` celowo BEZ wiersza w `profiles` - to okno, w którym self-INSERT jest
-- możliwy (skasowany profil przy żywym koncie `auth.users`, nieudany provisioning).
ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Domena tenanta A jest potrzebna w sekcji F: polityka "Users insert own profile"
-- dopuszcza `tenant_id = COALESCE(current_tenant_id(), public_tenant_id())`,
-- a dla konta BEZ profilu pierwszy członek COALESCE jest NULL - tenanta wskazuje
-- wtedy wyłącznie host żądania. Bez domeny w katalogu żądanie nie ma jak
-- powiedzieć „jestem na witrynie tenanta A".
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('c9111111-1111-1111-1111-111111111111', 'tenant-vg-a', 'Tenant VG A', 'vg-a.example'),
  ('c9222222-2222-2222-2222-222222222222', 'tenant-vg-b', 'Tenant VG B', 'vg-b.example');

INSERT INTO auth.users (id, email) VALUES
  ('c9000000-0000-0000-0000-0000000000aa', 'admin-vg@vg.test'),
  ('c9000000-0000-0000-0000-0000000000bb', 'super-vg@vg.test'),
  ('c9000000-0000-0000-0000-0000000000cc', 'editor-vg@vg.test'),
  ('c9000000-0000-0000-0000-0000000000dd', 'member-vg@vg.test'),
  ('c9000000-0000-0000-0000-0000000000ee', 'target-vg@vg.test'),
  ('c9000000-0000-0000-0000-0000000000ff', 'claim-vg@vg.test'),
  ('c9000000-0000-0000-0000-0000000000b1', 'admin-vg-b@vg.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c9000000-0000-0000-0000-0000000000aa', 'admin-vg@vg.test', 'Admin VG',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000bb', 'super-vg@vg.test', 'Super VG',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000cc', 'editor-vg@vg.test', 'Editor VG',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000dd', 'member-vg@vg.test', 'Member VG',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000ee', 'target-vg@vg.test', 'Target VG',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000b1', 'admin-vg-b@vg.test', 'Admin VG B',
   'c9222222-2222-2222-2222-222222222222');

-- `super_admin` BEZ osobnej roli `admin` - dokładnie konto, które regres
-- 20260806094104 pozbawił uprawnienia (`has_role` dopasowuje rolę DOKŁADNIE).
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c9000000-0000-0000-0000-0000000000aa', 'admin',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000bb', 'super_admin',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000cc', 'editor',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000b1', 'admin',
   'c9222222-2222-2222-2222-222222222222');

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('c9c00000-0000-0000-0000-0000000000c1', 'c9111111-1111-1111-1111-111111111111',
   'Firma z tenanta A'),
  ('c9c00000-0000-0000-0000-0000000000c2', 'c9222222-2222-2222-2222-222222222222',
   'Firma z tenanta B');

-- ── A. Własność kolumn i zasięg triggerów (1-7) ──────────────────────────────
SELECT has_function('public', 'profiles_guard_verification', 'bramka weryfikacji istnieje');

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgname = 'profiles_guard_verification_trg'
       AND NOT tgisinternal
  ),
  'trigger profiles_guard_verification_trg jest zainstalowany'
);

-- tgtype: 1 = ROW, 2 = BEFORE, 4 = INSERT, 16 = UPDATE => 23. Sam UPDATE dałby 19.
-- INSERT jest w kontrakcie od 20260806130000: polityka "Users insert own profile"
-- pozwala wstawić WŁASNY wiersz, więc bramka na samym UPDATE nie widzi wiersza,
-- który RODZI SIĘ zweryfikowany.
SELECT is(
  (SELECT tgtype::int FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass
      AND tgname = 'profiles_guard_verification_trg'),
  23,
  'bramka weryfikacji pilnuje BEFORE INSERT OR UPDATE FOR EACH ROW'
);

-- `BEFORE UPDATE OF <kolumna>` odpala się według LISTY `SET` w zapytaniu, a nie
-- według realnej zmiany wartości - wartość podstawiona przez wcześniejszy trigger
-- BEFORE mijałaby bramkę. Pusty `tgattr` = brak listy kolumn = brak tego założenia.
SELECT is(
  (SELECT tgattr::text FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass
      AND tgname = 'profiles_guard_verification_trg'),
  '',
  'bramka weryfikacji nie ma listy kolumn (niezależna od kolejności triggerów)'
);

SELECT ok(
  (SELECT prosecdef FROM pg_proc
    WHERE oid = 'public.profiles_guard_verification()'::regprocedure),
  'bramka działa jako SECURITY DEFINER (kontroli roli nie omija RLS)'
);

-- Dublowana własność kolumn była przyczyną źródłową: cichy revert w bramce
-- „privileged" odpalał się alfabetycznie PRZED „verification" i maskował odmowę.
SELECT ok(
  pg_get_functiondef('public.profiles_guard_privileged_columns()'::regprocedure)
    NOT LIKE '%verified_at%',
  'profiles_guard_privileged_columns NIE dotyka kolumn weryfikacji (jedna kolumna = jedna bramka)'
);

SELECT is(
  (SELECT tgtype::int FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass
      AND tgname = 'profiles_guard_privileged_columns_trg'),
  23,
  'bramka firmy pilnuje BEFORE INSERT OR UPDATE (wiersz nie rodzi się z obcą firmą)'
);

-- ── B. Predykat can_manage_profile_verification (8-11) ───────────────────────
-- Jedno źródło prawdy dla czterech ścieżek: trigger, RPC panelu, RPC domen
-- weryfikacji i polityka RLS `verification_domains`.
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
SELECT is(public.can_manage_profile_verification(), true,
  'admin przechodzi predykat weryfikacji');

SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT is(public.can_manage_profile_verification(), true,
  'super_admin BEZ osobnej roli admin przechodzi predykat (regres 20260806094104)');

SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);
SELECT is(public.can_manage_profile_verification(), false,
  'editor NIE nadaje weryfikacji (odznaka expert = dożywotni VIP)');

SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);
SELECT is(public.can_manage_profile_verification(), false,
  'zwykły członek NIE nadaje weryfikacji');

-- ── C. Bezpośredni UPDATE pól weryfikacji (12-19) ────────────────────────────
-- Członek: odmowa TWARDA. Do 20260806150000 samonadanie było po cichu wycofywane
-- przez bramkę kolumn uprzywilejowanych i nie zostawiało śladu nigdzie.
SELECT throws_ok(
  $$ UPDATE public.profiles SET verified_at = now()
      WHERE id = 'c9000000-0000-0000-0000-0000000000dd' $$,
  '42501',
  'profiles: verification fields can only be changed by admin or super_admin',
  'członek nie nadaje sobie weryfikacji (42501, nie cichy revert)'
);

RESET ROLE;
SELECT is(
  (SELECT verified_at FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000dd'),
  NULL::timestamptz,
  'próba samonadania nie zostawia po sobie wartości'
);

-- Editor: przechodzi bramkę firmy, ale nie tę - parytet z admin_grant_profile_badge.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);

SELECT throws_ok(
  $$ UPDATE public.profiles SET verified_at = now()
      WHERE id = 'c9000000-0000-0000-0000-0000000000cc' $$,
  '42501',
  'profiles: verification fields can only be changed by admin or super_admin',
  'editor dostaje 42501 z komunikatem bramki'
);

RESET ROLE;
SELECT is(
  (SELECT verified_at FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000cc'),
  NULL::timestamptz,
  'editor nie nadaje sobie weryfikacji'
);

-- super_admin BEZ roli admin: to jest regres 20260806094104.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT lives_ok(
  $$ UPDATE public.profiles
        SET verified_at = now(),
            verified_by = 'c9000000-0000-0000-0000-0000000000bb'
      WHERE id = 'c9000000-0000-0000-0000-0000000000bb' $$,
  'super_admin bez roli admin przechodzi bramkę weryfikacji'
);

RESET ROLE;
SELECT isnt(
  (SELECT verified_at FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000bb'),
  NULL::timestamptz,
  'super_admin REALNIE zapisuje pola weryfikacji (regres 20260806094104)'
);

-- Admin w cudzym wierszu swojego tenanta + stempel audytowy.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT lives_ok(
  $$ UPDATE public.profiles
        SET verified_at = now(),
            verified_by = 'c9000000-0000-0000-0000-0000000000aa'
      WHERE id = 'c9000000-0000-0000-0000-0000000000ee' $$,
  'admin nadaje weryfikację w wierszu członka swojego obszaru roboczego'
);

RESET ROLE;
SELECT is(
  (SELECT verified_by FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000ee'),
  'c9000000-0000-0000-0000-0000000000aa'::uuid,
  'verified_by stempluje admina nadającego weryfikację'
);

-- ── D. Sankcjonowane ścieżki systemowe (20-23) ───────────────────────────────
-- `sync_org_verification()` ustawia flagę lokalnie na czas własnego UPDATE - bez
-- niej automat nie domknąłby weryfikacji po potwierdzeniu e-maila (sesją jest
-- wtedy zwykły użytkownik, nie staff).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);
SELECT set_config('app.verification_sync', 'on', true);

SELECT lives_ok(
  $$ UPDATE public.profiles SET verified_at = now()
      WHERE id = 'c9000000-0000-0000-0000-0000000000dd' $$,
  'furtka app.verification_sync przepuszcza zapis automatu'
);

SELECT set_config('app.verification_sync', 'off', true);
RESET ROLE;
SELECT isnt(
  (SELECT verified_at FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000dd'),
  NULL::timestamptz,
  'zapis przez furtkę FAKTYCZNIE wchodzi (nie ma już cichego pinu z bramki bliźniaczej)'
);

-- Brak sesji: `service_role`, cron, definer poza żądaniem HTTP. To nie jest
-- samonadanie, więc bramka milczy - i zapis wchodzi. WNIOSEK OPERACYJNY: klucz
-- serwisowy NIE jest chroniony przed pomyłką, automaty muszą iść przez
-- `sync_org_verification()` / `admin_run_org_verification()`.
SELECT set_config('request.jwt.claims', '', true);

SELECT lives_ok(
  $$ UPDATE public.profiles SET verified_at = NULL, verified_by = NULL
      WHERE id = 'c9000000-0000-0000-0000-0000000000dd' $$,
  'ścieżka bez auth.uid() nie jest traktowana jak samonadanie (brak 42501)'
);

SELECT is(
  (SELECT verified_at FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000dd'),
  NULL::timestamptz,
  'ścieżka bez sesji realnie zdejmuje weryfikację (kontrakt ścieżki serwisowej)'
);

-- ── E. Izolacja obszarów roboczych (24-26) ───────────────────────────────────
-- Weryfikacja nadaje odznakę, a odznaka `expert` dożywotni VIP - admin tenanta B
-- nie może stemplować tego w tenancie A. Sesję udajemy samymi claimami JWT, bez
-- `SET ROLE authenticated`: właściciel tabeli pomija RLS, więc UPDATE DOCHODZI do
-- triggera zamiast wyparować na polityce. Dokładnie tak wygląda ścieżka
-- SECURITY DEFINER / service_role z podstawionym `sub`.
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

SELECT throws_ok(
  $$ UPDATE public.profiles SET verified_at = now()
      WHERE id = 'c9000000-0000-0000-0000-0000000000dd' $$,
  '42501',
  'profiles: verification can only be changed inside the caller workspace',
  'admin tenanta B nie zweryfikuje profilu z tenanta A bezpośrednim UPDATE'
);

SELECT is(
  (SELECT verified_at FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000dd'),
  NULL::timestamptz,
  'profil z tenanta A zostaje niezweryfikowany po próbie z tenanta B'
);

SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$ SELECT public.admin_set_profile_verification(
       'c9000000-0000-0000-0000-0000000000dd', true) $$,
  '%target outside caller tenant%',
  'RPC panelu odrzuca cel spoza obszaru roboczego wołającego'
);
RESET ROLE;

-- ── F. INSERT: wiersz nie rodzi się zweryfikowany (27-30) ────────────────────
-- Konto `ff` ma żywy wiersz w `auth.users`, ale NIE ma profilu - w tym oknie
-- polityka "Users insert own profile" pozwala wstawić własny wiersz, a bramka na
-- samym UPDATE nie miała czego pilnować.
--
-- Żądanie MUSI nieść host tenanta A. Dla konta bez profilu `current_tenant_id()`
-- jest NULL, więc jedynym źródłem tenanta w polityce INSERT jest
-- `public_tenant_id()`; bez nagłówka spada ono na tenanta DOMYŚLNEGO i RLS
-- odrzuca wiersz (42501) jeszcze zanim którakolwiek bramka kolumnowa zdąży się
-- wypowiedzieć - mierzylibyśmy wtedy politykę, nie bramkę. To jest ta sama
-- ścieżka, którą idzie prawdziwe zakładanie profilu na witrynie tenanta.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
SELECT set_config('request.headers', '{"x-tenant-host":"vg-a.example"}', true);

SELECT throws_ok(
  $$ INSERT INTO public.profiles (id, email, display_name, tenant_id, verified_at)
     VALUES ('c9000000-0000-0000-0000-0000000000ff', 'claim-vg@vg.test', 'Claim VG',
             'c9111111-1111-1111-1111-111111111111', now()) $$,
  '42501',
  'profiles: verification fields can only be changed by admin or super_admin',
  'self-INSERT z verified_at jest odrzucany (luka z 20260806130000)'
);

-- Ten sam self-INSERT bez pól weryfikacji przechodzi - bramka nie jest szeroka -
-- ale wskazanie firmy z OBCEGO obszaru roboczego jest po cichu zdejmowane.
SELECT lives_ok(
  $$ INSERT INTO public.profiles (id, email, display_name, tenant_id, current_company_id)
     VALUES ('c9000000-0000-0000-0000-0000000000ff', 'claim-vg@vg.test', 'Claim VG',
             'c9111111-1111-1111-1111-111111111111',
             'c9c00000-0000-0000-0000-0000000000c2') $$,
  'self-INSERT bez pól weryfikacji przechodzi (bramka nie jest szeroka)'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000ff'),
  1,
  'wiersz powstał - reakcją bramki firmy jest cichy revert, nie odmowa'
);

SELECT is(
  (SELECT current_company_id FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000ff'),
  NULL::uuid,
  'wiersz nie rodzi się ze wskazaniem firmy z obcego obszaru roboczego'
);

-- Dalsze sekcje rozstrzygają tenanta z profilu (current_tenant_id()), więc host
-- żądania zdejmujemy - żeby nagłówek nie brał udziału w niczym poza sekcją F.
SELECT set_config('request.headers', '', true);

-- ── G. current_company_id: właściciel ma prawo do SWOJEJ firmy (31-34) ───────
-- Przed 20260806150000 bramka cofała tę kolumnę KAŻDEMU nie-stafowi, w tym
-- właścicielowi wiersza - a to jedyna ścieżka, którą pole ustawia UI. Członek
-- dostawał zielony toast i zero zmiany w bazie.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.link_current_company('c9c00000-0000-0000-0000-0000000000c1') $$,
  'członek przypisuje sobie firmę z własnego obszaru roboczego (ścieżka UI)'
);

RESET ROLE;
SELECT is(
  (SELECT current_company_id FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000dd'),
  'c9c00000-0000-0000-0000-0000000000c1'::uuid,
  'przypisanie firmy przez właściciela FAKTYCZNIE zapisuje się w bazie'
);

-- Firma z obcego tenanta bezpośrednim UPDATE: to nie jest atak wymagający
-- wyjątku (RPC ma jawny `tenant_mismatch`), ale wartość nie może wejść.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);

SELECT lives_ok(
  $$ UPDATE public.profiles
        SET current_company_id = 'c9c00000-0000-0000-0000-0000000000c2'
      WHERE id = 'c9000000-0000-0000-0000-0000000000dd' $$,
  'podstawienie firmy z obcego tenanta nie wywala zapisu do profilu'
);

RESET ROLE;
SELECT is(
  (SELECT current_company_id FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000dd'),
  'c9c00000-0000-0000-0000-0000000000c1'::uuid,
  'firma z OBCEGO obszaru roboczego jest po cichu wycofana (zostaje poprzednia)'
);

-- ── H. RPC panelu: ten sam predykat co trigger (35-37) ───────────────────────
-- Bez parytetu naprawa bramki byłaby martwa: `admin_set_profile_verification`
-- to jedyna ścieżka zapisu z panelu (src/routes/admin.users.$id.tsx).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.admin_set_profile_verification(
       'c9000000-0000-0000-0000-0000000000cc', true) $$,
  'super_admin nadaje weryfikację przez RPC panelu'
);

RESET ROLE;
SELECT is(
  (SELECT verified_by FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000cc'),
  'c9000000-0000-0000-0000-0000000000bb'::uuid,
  'RPC stempluje super_admina jako nadającego'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.admin_set_profile_verification(
       'c9000000-0000-0000-0000-0000000000dd', true) $$,
  '42501',
  'forbidden: admin or super_admin role required',
  'RPC odmawia editorowi z ERRCODE 42501 (nie gołym P0001)'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
