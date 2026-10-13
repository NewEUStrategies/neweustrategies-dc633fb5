-- ============================================================================
-- SCALENIE Z MAIN (PR #504), CZ. 8 (OSTATNIA): NAPRAWA HISTORII REG-01 PO
-- MIGRACJACH UZGADNIAJACYCH (decyzja D14).
--
-- DEFEKT. Migracje uzgadniajace 20261013900000-900600 sortuja sie PO naprawie
--   REG-01 (20261012190000/190100), a 20261013900400 redefiniuje pisarza
--   `event_people.user_id` (`event_package_invite_accept` - konto wiaze sie
--   wylacznie przez `_event_bind_uid_for_email`, regula bez zmian). W
--   produkcji wszystkie migracje main biegly PRZED plikami REG, a w replayu
--   (kolejnosc nazw) pliki main z 20261012200000 i 20261013* biegna PO naprawie
--   - zaden z nich nie pisze `event_people.user_id` ani nie zmienia helperow
--   dowiazania (tabela uzgodnien w opisie PR #504).
--   Inwariant serii REG: migracja dotykajaca pisarzy `user_id` biegnie PRZED
--   ostatnim przebiegiem naprawy - stad ten plik.
--
-- ZMIANA. Ten sam przebieg co 20261012190100: rejestr kont zalozonych przez
--   administratora (`_auth_admin_provisioned_backfill`, idempotentny) i
--   odwiazanie wszystkiego, co audyt `event_people_account_binding_audit()`
--   zwraca w tej chwili (`_event_people_unbind_unverified`, wpis w
--   `event_person_account_unbinds`). Na bazie po 20261012190100 - 0 i 0.
--
-- CZEGO TO NIE ZAMYKA: jak 20261012190100 (przeglad `suspect_takeover` nalezy
--   do organizatora). Plik bez znacznika harnessu wydarzen (harness nie ma
--   `user_invitations`, a jego baza startuje pusta - naprawa jest no-opem).
-- KOLEJNOSC WDROZENIA: OSTATNIA migracja serii REG i scalenia - po
--   20261013900000-900600. Przed i po: `SELECT count(*) FROM
--   public.event_people_account_binding_audit()` = 0.
-- IDEMPOTENTNA: obie funkcje robia wylacznie to, co jest do zrobienia
--   w danej chwili; licznik audytu po przebiegu idzie do logu wdrozenia
--   (NOTICE) - operator nie musi pytac bazy osobno.
-- DOWOD: supabase/tests/reg_main_merge_test.sql (audyt = 0 po replayu obu
--   kolejnosci), supabase/tests/event_people_account_binding_test.sql.
-- ============================================================================

SELECT public._auth_admin_provisioned_backfill();
SELECT public._event_people_unbind_unverified('reg01_remediation');

DO $$
DECLARE
  v_left integer;
BEGIN
  SELECT count(*)::integer INTO v_left FROM public.event_people_account_binding_audit();
  RAISE NOTICE 'REG-01 po scaleniu z main: audyt dowiazan = % (kryterium: 0)', v_left;
END
$$;
