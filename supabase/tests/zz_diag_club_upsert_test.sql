-- ============================================================================
-- SONDA DIAGNOSTYCZNA - PLIK TYMCZASOWY, DO USUNIECIA PO ROZSTRZYGNIECIU.
--
-- PROBLEM. Piec plikow modulu klubow (discussion_clubs_a1..a5_a6) przechodzi
-- LOKALNIE na pelnym schemacie (759 migracji + supabase/seed.sql + pgvector,
-- a1 daje 47/47) i PADA w CI, zawsze na pierwszym wywolaniu `admin_club_upsert`.
--
-- Co juz wykluczono, kazde pomiarem, nie domysem:
--   * brak `seed.sql` w lokalnym runnerze - dodany, pliki nadal zielone;
--   * `SET LOCAL ROLE authenticated` - 62 inne pliki testowe robia to samo
--     i sa w CI zielone;
--   * brak grantu EXECUTE dla `authenticated` - asercje `has_function_privilege`
--     dodane w #219 PRZECHODZA w CI;
--   * forma roszczenia JWT - 73 zielone pliki uzywaja tej samej formy
--     `request.jwt.claims` (JSON), nie wariantu z kropka;
--   * atrapa typu wektorowego - pgvector zainstalowany lokalnie;
--   * rola bazy - po przepieciu adminowych RPC na wlasciciela awaria przesunela
--     sie DOKLADNIE o liczbe dodanych asercji grantu i zostala w tym samym
--     miejscu scenariusza.
--
-- DLACZEGO OSOBNY PLIK, a nie sonda w a1. `lives_ok` nie podaje tresci bledu,
-- `output` check-runu jest puste, a log joba dociera do nas OBCIETY do koncowki.
-- pg_prove uruchamia pliki alfabetycznie, wiec prefiks `zz_` gwarantuje, ze
-- wyjscie tej sondy stoi na SAMYM KONCU logu - w czesci, ktora widzimy.
--
-- Plik nie asertuje niczego o produkcie (jedno `ok(true)`), wiec nie moze
-- zafarbowac bramki na czerwono; jego jedynym zadaniem jest WYPISAC SQLSTATE
-- i komunikat wraz z kontekstem tozsamosci.
-- ============================================================================
BEGIN;
SELECT plan(1);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug)
VALUES ('dd111111-1111-1111-1111-111111111111', 'Tenant DIAG', 'tenant-diag-club-probe')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('dd000000-0000-0000-0000-000000000001', 'admin-diag@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable)
VALUES ('dd000000-0000-0000-0000-000000000001',
        'dd111111-1111-1111-1111-111111111111', 'Admin DIAG', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('dd000000-0000-0000-0000-000000000001', 'admin',
        'dd111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claims',
  '{"sub":"dd000000-0000-0000-0000-000000000001"}', true);

-- Kontekst PRZED wywolaniem: jesli tu cokolwiek jest NULL-em albo wskazuje inny
-- tenant niz DIAG, to jest odpowiedz na cale pytanie.
DO $$
BEGIN
  RAISE WARNING 'DIAG kontekst: auth.uid=% current_tenant_id=% public_tenant_id=% is_club_admin=% current_user=% role_guc=%',
    auth.uid(),
    public.current_tenant_id(),
    public.public_tenant_id(),
    public.is_club_admin(auth.uid()),
    current_user,
    current_setting('role', true);
END $$;

DO $$
DECLARE
  v_club uuid;
BEGIN
  v_club := public.admin_club_upsert(
    '{"slug":"klub-sonda-diagnostyczna","name_pl":"Sonda","name_en":"Probe",
      "visibility":"members","status":"active"}'::jsonb);
  RAISE WARNING 'DIAG admin_club_upsert: PRZESZLO (club_id=%)', v_club;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'DIAG admin_club_upsert: SQLSTATE=% MESSAGE=% DETAIL=% HINT=% CONTEXT-brak',
    SQLSTATE, SQLERRM,
    COALESCE(NULLIF(current_setting('diag.detail', true), ''), '-'),
    COALESCE(NULLIF(current_setting('diag.hint', true), ''), '-');
END $$;

SELECT ok(true, 'sonda diagnostyczna wykonala sie (wynik w WARNING powyzej)');

SELECT * FROM finish();
ROLLBACK;
