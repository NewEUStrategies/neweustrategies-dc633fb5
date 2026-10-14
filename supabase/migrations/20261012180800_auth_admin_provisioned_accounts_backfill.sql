-- ============================================================================
-- REJESTR KONT ZALOZONYCH PRZEZ ADMINISTRATORA - WYPELNIENIE Z ZAPROSZEN
-- (PRZEGLAD R12, USTALENIE 4; REG-01, decyzja D1).
--
-- DEFEKT: konta zalozone przed 20261012180600 przez zaproszenie w trybie
--   hasla tymczasowego albo import zespolu maja `email_confirmed_at` nadane
--   przez administratora (`createUser({ email_confirm: true })`) i NIE maja
--   znacznika `app_metadata.provisioned_by_admin` - kod, ktory go ustawia,
--   wchodzi razem z ta seria. Bez wpisu modul wydarzen dalej uznawalby je za
--   wlascicieli adresu (D1).
--
-- ZMIANA 20261012 (R12): `_auth_admin_provisioned_backfill()` wypelnia
--   `auth_admin_provisioned_accounts` z `user_invitations`: zaproszenie
--   `mode = 'temp_password'` z `auth_user_id`, adres konta = adres
--   zaproszenia (zwijanie A-Z), konto potwierdzone ORAZ jeden z dowodow, ze
--   konto zalozyl ten przeplyw, a nie rejestracja wlasna:
--     * `raw_user_meta_data` ma `must_change_password` (oba miejsca
--       `createUser` w invitations.functions.ts je ustawiaja; nic innego) albo
--       `provisioned = true` (import zespolu);
--     * konto powstalo PO zaproszeniu (`u.created_at >= i.created_at`) -
--       wysylka zaklada konto tylko, gdy go nie znalazla.
--   Zrodlo: `team_provision` dla zaproszen `source LIKE 'provision:%'`, inaczej
--   `invitation_temp_password`. Pierwsze zaproszenie konta wygrywa.
--   Bez zapisu do schematu `auth` (rola migracji na Supabase nie musi go
--   miec) - dlatego rejestr w `public`, a nie uzupelnienie `app_metadata`.
--
-- CZEGO TO NIE ZAMYKA: konto zalozone na zaproszenie, ktore potem usunieto
--   (brak wiersza `user_invitations`), i konto, ktorego wlasciciel sam usunal
--   `must_change_password` z metadanych, a powstalo przed zaproszeniem - poza
--   rejestrem. Falszywy wpis (rejestracja wlasna miedzy utworzeniem
--   a wysylka zaproszenia na ten sam adres) zdejmuje potwierdzona zmiana
--   adresu konta albo przywrocenie przez organizatora - kierunek bezpieczny.
--   Plik bez znacznika harnessu wydarzen: harness nie ma `user_invitations`.
-- KOLEJNOSC WDROZENIA: po 20261012180600 (tabela rejestru), PRZED
--   20261012190000/190100 (naprawa historii odwiazuje dowiazania takich kont).
--   Wzgledem kodu dowolna.
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT; funkcja
--   pisze INSERT ... ON CONFLICT (user_id) DO NOTHING - ponowne wywolanie
--   dopisuje wylacznie brakujace konta.
-- DOWOD: supabase/tests/event_identity_consents_r12_test.sql (zaproszenie
--   temp_password -> wpis rejestru -> konto nie jest wlascicielem adresu;
--   magic_link i konto sprzed zaproszenia - bez wpisu).
-- ============================================================================

-- Funkcja, a nie gole INSERT: naprawa 20261012190100 wola ja ponownie (konta
-- zalozone starym kodem w oknie miedzy migracjami a wdrozeniem kodu), a pgTAP
-- sprawdza regule na fiksturach.
CREATE OR REPLACE FUNCTION public._auth_admin_provisioned_backfill()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.auth_admin_provisioned_accounts (user_id, email_norm, tenant_id, invitation_id, source)
  SELECT DISTINCT ON (u.id)
         u.id,
         lower(btrim(u.email) COLLATE "C"),
         i.tenant_id,
         i.id,
         CASE WHEN COALESCE(i.source, '') LIKE 'provision:%' THEN 'team_provision'
              ELSE 'invitation_temp_password' END
    FROM public.user_invitations i
    JOIN auth.users u ON u.id = i.auth_user_id
   WHERE i.mode = 'temp_password'
     AND u.email_confirmed_at IS NOT NULL
     AND NULLIF(lower(btrim(u.email) COLLATE "C"), '') = lower(btrim(i.email) COLLATE "C")
     AND (
       COALESCE(u.raw_user_meta_data, '{}'::jsonb) ? 'must_change_password'
       OR COALESCE(u.raw_user_meta_data->>'provisioned', '') = 'true'
       OR u.created_at >= i.created_at
     )
   ORDER BY u.id, i.created_at, i.id
  ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public._auth_admin_provisioned_backfill() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._auth_admin_provisioned_backfill() TO service_role;

COMMENT ON FUNCTION public._auth_admin_provisioned_backfill() IS
  'R12 (D1): dopisuje do auth_admin_provisioned_accounts konta zalozone przez administratora z potwierdzonym adresem (zaproszenie temp_password: must_change_password/provisioned w user_metadata albo konto mlodsze niz zaproszenie; adres konta = adres zaproszenia). Idempotentna (ON CONFLICT DO NOTHING), zwraca liczbe nowych wpisow. Tylko service_role; wolaja ja migracje 20261012180800 i 20261012190100.';

SELECT public._auth_admin_provisioned_backfill();
