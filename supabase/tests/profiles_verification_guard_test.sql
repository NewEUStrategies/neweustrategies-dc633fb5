-- pgTAP: samodzielne nadanie sobie statusu "zweryfikowany" jest niemozliwe.
--
-- Polityka "Users update own profile" pozwala uzytkownikowi aktualizowac
-- wlasny wiersz w profiles. Bez dodatkowej bramki obejmowaloby to takze
-- verified_at / verified_by, czyli pola ustawiane wylacznie przez personel
-- podczas weryfikacji tozsamosci. Trigger profiles_guard_verification_trg
-- odrzuca taka zmiane dla nie-adminow.

BEGIN;
SELECT plan(3);

SELECT has_function('public', 'profiles_guard_verification', 'guard function exists');

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgname = 'profiles_guard_verification_trg'
       AND NOT tgisinternal
  ),
  'BEFORE UPDATE trigger on public.profiles is installed'
);

SELECT ok(
  (SELECT prosecdef FROM pg_proc
    WHERE oid = 'public.profiles_guard_verification()'::regprocedure),
  'guard runs as SECURITY DEFINER (role check cannot be bypassed by RLS)'
);

SELECT * FROM finish();
ROLLBACK;
